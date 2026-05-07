import { createServer, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { createPublicClient, createWalletClient, getAddress, http, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { RelayInputs } from "./types.ts";
import { isFeeDataProfitable } from "./fees.ts";
import { relayTx } from "./transact.ts";
import { BurnWallet } from "./BurnWallet.ts";
import { getCircuitSize, getContractConfig } from "./utils.ts";

export interface RelayerConfig {
    privateKey: Hex;
    rpcUrl: string;
    tokenAddress: Address;
    tokensPerEthPrice: Hex;
    minRelayerBonus: Hex;
    /** How much (%) our gas estimate may exceed feeData.estimatedGasCost before rejecting. Default 20. */
    gasEstimateTolerancePercent?: number;
    /** How much (%) the current priority fee may exceed feeData.estimatedPriorityFee before rejecting. Default 0. */
    priorityFeeTolerancePercent?: number;
    /** Override gas estimates per circuit size instead of calling BurnWallet.estimateGas. */
    gasEstimation?: { [circuitSize: number]: Hex };
    /** Override the priority fee used for submission instead of calling estimateMaxPriorityFeePerGas. */
    priorityFee?: Hex;
    /** Minimum profit margin (%) on top of relayerPayout required to accept a relay. Default 5. */
    minProfitMarginPercent?: number;
}

const DEFAULT_GAS_ESTIMATE_TOLERANCE_PERCENT = 20;
const DEFAULT_PRIORITY_FEE_TOLERANCE_PERCENT = 20;
const DEFAULT_MIN_PROFIT_MARGIN_PERCENT = 5;

export interface QuoteResult {
    relayerAddress: Address;
    tokensPerEthPrice: Hex;
    estimatedGasCost: Hex;
    estimatedPriorityFee: Hex;
    minRelayerBonus: Hex;
}

export type RelayError =
    | { error: "invalid_input"; details: unknown }
    | { error: "wrong_relayer"; expected: Address; got: Address }
    | { error: "exchange_rate_too_low"; minTokensPerEthPrice: Hex; got: Hex }
    | { error: "relayer_bonus_too_low"; minRelayerBonus: Hex; got: Hex }
    | { error: "gas_estimate_too_low"; ourEstimate: Hex; got: Hex; acceptableParams: QuoteResult }
    | { error: "priority_fee_too_low"; currentPriorityFee: Hex; got: Hex; acceptableParams: QuoteResult }
    | { error: "unprofitable"; gasCostInTokens: Hex; relayerPayout: Hex; maxFee: Hex; acceptableParams: QuoteResult }

export type RelayResult =
    | { ok: true; txHash: Hex }
    | { ok: false } & RelayError

export class Relayer {
    readonly wallet: WalletClient & { account: ReturnType<typeof privateKeyToAccount> };
    readonly publicClient: PublicClient;
    readonly config: RelayerConfig;

    #decimalsTokenPrice: number | undefined;
    #verifierSizes: number[] | undefined;
    #burnWallet: BurnWallet | undefined;

    constructor(config: RelayerConfig) {
        this.config = config;
        const account = privateKeyToAccount(config.privateKey);
        this.publicClient = createPublicClient({ transport: http(config.rpcUrl) });
        this.wallet = createWalletClient({ account, transport: http(config.rpcUrl) }) as WalletClient & { account: typeof account };
    }

    get address(): Address {
        return this.wallet.account.address;
    }

    async #initialize(): Promise<void> {
        const chainId = await this.publicClient.getChainId();
        const contractConfig = await getContractConfig(this.config.tokenAddress, this.publicClient);
        this.#decimalsTokenPrice = Number(BigInt(contractConfig.decimalsTokenPrice));
        this.#verifierSizes = contractConfig.VERIFIER_SIZES;
        this.#burnWallet = new BurnWallet(this.wallet, {
            archiveNodes: { [chainId]: this.publicClient },
            acceptedChainIds: [chainId],
        });
    }

    async #gasEstimate(circuitSize: number): Promise<bigint> {
        const override = this.config.gasEstimation?.[circuitSize];
        if (override !== undefined) return BigInt(override);
        return this.#burnWallet!.estimateGas(this.config.tokenAddress, circuitSize);
    }

    async #submissionPriorityFee(): Promise<bigint> {
        if (this.config.priorityFee !== undefined) return BigInt(this.config.priorityFee);
        return this.publicClient.estimateMaxPriorityFeePerGas();
    }

    async quote(circuitSize: number): Promise<QuoteResult> {
        const [estimatedGasCost, estimatedPriorityFee] = await Promise.all([
            this.#gasEstimate(circuitSize),
            this.#submissionPriorityFee(),
        ]);
        return {
            relayerAddress: this.address,
            tokensPerEthPrice: this.config.tokensPerEthPrice,
            estimatedGasCost: toHex(estimatedGasCost),
            estimatedPriorityFee: toHex(estimatedPriorityFee),
            minRelayerBonus: this.config.minRelayerBonus,
        };
    }

    async relay(inputs: RelayInputs): Promise<RelayResult> {
        const feeData = inputs.signatureInputs.feeData;

        // Cheap checks first — no RPC calls needed
        if (getAddress(feeData.relayerAddress) !== this.address) {
            return { ok: false, error: "wrong_relayer", expected: this.address, got: feeData.relayerAddress };
        }
        if (BigInt(feeData.tokensPerEthPrice) < BigInt(this.config.tokensPerEthPrice)) {
            return { ok: false, error: "exchange_rate_too_low", minTokensPerEthPrice: this.config.tokensPerEthPrice, got: feeData.tokensPerEthPrice };
        }
        if (BigInt(feeData.relayerBonus) < BigInt(this.config.minRelayerBonus)) {
            return { ok: false, error: "relayer_bonus_too_low", minRelayerBonus: this.config.minRelayerBonus, got: feeData.relayerBonus };
        }

        const circuitSize = getCircuitSize(inputs.publicInputs.burn_data_public.length, this.#verifierSizes!);

        // Fetch everything we need in parallel before any accounting checks
        const [block, gasLimit, submissionPriorityFee] = await Promise.all([
            this.publicClient.getBlock({ blockTag: "latest" }),
            this.#gasEstimate(circuitSize),
            this.#submissionPriorityFee(),
        ]);
        const baseFeePerGas = block.baseFeePerGas ?? 0n;

        // Pre-build acceptableParams once so each error below can reuse it without extra RPC calls
        const acceptableParams: QuoteResult = {
            relayerAddress: this.address,
            tokensPerEthPrice: this.config.tokensPerEthPrice,
            estimatedGasCost: toHex(gasLimit),
            estimatedPriorityFee: toHex(submissionPriorityFee),
            minRelayerBonus: this.config.minRelayerBonus,
        };

        // feeData.estimatedGasCost is what the contract will compensate us for.
        // If our actual gas estimate exceeds that by more than the tolerance, we'd lose money.
        const gasTolerance = BigInt(this.config.gasEstimateTolerancePercent ?? DEFAULT_GAS_ESTIMATE_TOLERANCE_PERCENT);
        if (gasLimit > BigInt(feeData.estimatedGasCost) * (100n + gasTolerance) / 100n) {
            return { ok: false, error: "gas_estimate_too_low", ourEstimate: toHex(gasLimit), got: feeData.estimatedGasCost, acceptableParams };
        }

        // feeData.estimatedPriorityFee is what the contract uses for our fee compensation.
        // If what we'll actually submit exceeds that (beyond tolerance), we'd pay more ETH than compensated.
        const priorityFeeTolerance = BigInt(this.config.priorityFeeTolerancePercent ?? DEFAULT_PRIORITY_FEE_TOLERANCE_PERCENT);
        if (submissionPriorityFee > BigInt(feeData.estimatedPriorityFee) * (100n + priorityFeeTolerance) / 100n) {
            return { ok: false, error: "priority_fee_too_low", currentPriorityFee: toHex(submissionPriorityFee), got: feeData.estimatedPriorityFee, acceptableParams };
        }

        // Full profitability check: relayerPayout (gasCostInTokens + relayerBonus) + margin must not exceed maxFee
        const { profitable, gasCostInTokens, relayerPayout } = isFeeDataProfitable(feeData, this.#decimalsTokenPrice!, baseFeePerGas, this.config.minProfitMarginPercent ?? DEFAULT_MIN_PROFIT_MARGIN_PERCENT);
        if (!profitable) {
            return { ok: false, error: "unprofitable", gasCostInTokens: toHex(gasCostInTokens), relayerPayout: toHex(relayerPayout), maxFee: feeData.maxFee, acceptableParams };
        }

        const txHash = await relayTx(inputs, this.wallet, { gasLimit, maxPriorityFeePerGas: submissionPriorityFee });
        return { ok: true, txHash };
    }

    async start(port = 3000): Promise<void> {
        await this.#initialize();
        console.log(`Relayer address: ${this.address}, decimalsTokenPrice: ${this.#decimalsTokenPrice}`);

        const readBody = (req: IncomingMessage): Promise<string> =>
            new Promise((resolve, reject) => {
                let data = "";
                req.on("data", (chunk: Buffer) => { data += chunk; });
                req.on("end", () => resolve(data));
                req.on("error", reject);
            });

        const server = createServer(async (req, res) => {
            const url = new URL(req.url ?? "/", `http://localhost:${port}`);

            const send = (status: number, body: unknown) => {
                res.writeHead(status, { "Content-Type": "application/json" });
                res.end(JSON.stringify(body));
            };

            try {
                if (req.method === "GET" && url.pathname === "/quote") {
                    const circuitSize = Number(url.searchParams.get("circuitSize"));
                    if (!circuitSize) { send(400, { error: "missing_param", param: "circuitSize" }); return; }
                    send(200, await this.quote(circuitSize));
                    return;
                }

                if (req.method === "POST" && url.pathname === "/relay") {
                    let inputs: RelayInputs;
                    try {
                        inputs = JSON.parse(await readBody(req)) as RelayInputs;
                    } catch {
                        send(400, { error: "invalid_input", details: "body is not valid JSON" });
                        return;
                    }
                    const result = await this.relay(inputs);
                    send(result.ok ? 200 : 400, result);
                    return;
                }

                send(404, { error: "not_found" });
            } catch (err) {
                send(500, { error: "internal", details: err instanceof Error ? err.message : String(err) });
            }
        });

        server.listen(port, () => {
            console.log(`Relayer listening on http://localhost:${port}`);
        });
    }
}

// Run when executed directly: tsx src/Relayer.ts
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const relayer = new Relayer({
        privateKey: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // hardhat account #0
        rpcUrl: "http://127.0.0.1:8545",
        tokenAddress: "0x0000000000000000000000000000000000000000", // replace with deployed token address
        tokensPerEthPrice: "0x0",
        minRelayerBonus: "0x0",
    });
    relayer.start();
}
