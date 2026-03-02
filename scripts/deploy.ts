/**
 * Deploy via Ignition + verify all contracts using the HH3 programmatic API.
 * Uses `verifyContract` from @nomicfoundation/hardhat-verify/verify (not hre.run).
 *
 * IMPORTANT: Must run with --build-profile production so verify can find
 * the production compilation artifacts (which match deployed bytecode):
 *
 *   yarn hardhat run --build-profile production scripts/deployAndVerify.ts --network sepolia
 */
import hre from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import { toHex } from "viem";
import wormholeTokenModule from "../ignition/modules/wormtoken.ts";
import { POW_DIFFICULTY, RE_MINT_LIMIT } from "../src/constants.ts";

const WAIT_MS = 30_000; // wait for Etherscan indexing

interface VerifyEntry {
    name: string;
    address: string;
    constructorArgs?: any[];
    contract?: string; // fully qualified name "path:ContractName" to disambiguate
    libraries?: Record<string, string>; // library name -> deployed address
}

async function main() {
    // ── Deploy ──────────────────────────────────────────────────────
    const connection = await hre.network.connect();
    const deployed = await connection.ignition.deploy(wormholeTokenModule);

    const addr = (c: any) => c.address as string;
    const addresses = {
        ZKTranscriptLib:               addr(deployed.ZKTranscriptLib),
        leanIMTPoseidon2:              addr(deployed.leanIMTPoseidon2),
        PrivateTransfer2inVerifier:    addr(deployed.PrivateTransfer2inVerifier),
        PrivateTransfer100InVerifier:  addr(deployed.PrivateTransfer100InVerifier),
        WormholeToken:                 addr(deployed.wormholeToken),
    };

    console.log("\n🚀 Deployed:");
    for (const [name, a] of Object.entries(addresses)) console.log(`  ${name}: ${a}`);

    // ── Wait for Etherscan to index ─────────────────────────────────
    console.log(`\n⏳ Waiting ${WAIT_MS / 1000}s for Etherscan indexing...`);
    await new Promise((r) => setTimeout(r, WAIT_MS));

    // ── Verify ──────────────────────────────────────────────────────
    // ZKTranscriptLib exists in both verifier .sol files with identical bytecode,
    // so we must specify which one via `contract` (fully qualified name).
    const contracts: VerifyEntry[] = [
        // Libraries first (no library deps themselves)
        {
            name: "ZKTranscriptLib",
            address: addresses.ZKTranscriptLib,
            contract: "contracts/reMint2Verifier.sol:ZKTranscriptLib",
        },
        {
            name: "leanIMTPoseidon2",
            address: addresses.leanIMTPoseidon2,
            contract: "contracts/leanIMTPoseidon2.sol:leanIMTPoseidon2",
        },
        // Verifiers depend on ZKTranscriptLib
        {
            name: "PrivateTransfer2inVerifier",
            address: addresses.PrivateTransfer2inVerifier,
            contract: "contracts/reMint2Verifier.sol:reMint2Verifier",
            libraries: { ZKTranscriptLib: addresses.ZKTranscriptLib },
        },
        {
            name: "PrivateTransfer100InVerifier",
            address: addresses.PrivateTransfer100InVerifier,
            contract: "contracts/reMint100Verifier.sol:reMint100Verifier",
            libraries: { ZKTranscriptLib: addresses.ZKTranscriptLib },
        },
        // WormholeToken depends on leanIMTPoseidon2
        {
            name: "WormholeToken",
            address: addresses.WormholeToken,
            contract: "contracts/WormholeToken.sol:WormholeToken",
            constructorArgs: [
                addresses.PrivateTransfer2inVerifier,
                addresses.PrivateTransfer100InVerifier,
                toHex(POW_DIFFICULTY, { size: 32 }),
                RE_MINT_LIMIT,
            ],
            libraries: { leanIMTPoseidon2: addresses.leanIMTPoseidon2 },
        },
    ];

    const results: { name: string; ok: boolean; msg: string }[] = [];

    for (const c of contracts) {
        console.log(`\n🔍 Verifying ${c.name} at ${c.address}...`);
        try {
            await verifyContract(
                {
                    address: c.address,
                    constructorArgs: c.constructorArgs ?? [],
                    contract: c.contract,
                    libraries: c.libraries,
                    provider: "etherscan",
                },
                hre,
            );
            console.log(`  ✅ ${c.name} verified`);
            results.push({ name: c.name, ok: true, msg: "verified" });
        } catch (e: any) {
            const msg = e?.message ?? String(e);
            if (msg.toLowerCase().includes("already verified")) {
                console.log(`  ✅ ${c.name} already verified`);
                results.push({ name: c.name, ok: true, msg: "already verified" });
            } else {
                console.error(`  ❌ ${c.name} failed: ${msg}`);
                results.push({ name: c.name, ok: false, msg });
            }
        }
    }

    // ── Summary ─────────────────────────────────────────────────────
    console.log("\n═══ Verification Summary ═══");
    for (const r of results) {
        console.log(`  ${r.ok ? "✅" : "❌"} ${r.name}: ${r.msg}`);
    }

    const failures = results.filter((r) => !r.ok);
    if (failures.length > 0) {
        process.exit(1);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});