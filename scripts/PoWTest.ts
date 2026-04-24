import assert from "node:assert/strict";
import { beforeEach, describe, it, after } from "node:test";

import { network } from "hardhat";

import type { BurnAccount } from "../src/types.ts";
import { BurnWallet } from "../src/BurnWallet.ts";
import { FIELD_LIMIT, TransWarpTokenContractName, reMint3InVerifierContractName, reMint32InVerifierContractName, reMint100InVerifierContractName, leanIMTPoseidon2ContractName, ZKTranscriptLibContractName100, POW_DIFFICULTY, RE_MINT_LIMIT, MAX_TREE_DEPTH } from "../src/constants.ts";
import { padHex, toHex } from "viem";
import { deployPoseidon2Huff } from "@warptoad/gigabridge-js";


describe("Token", async function () {
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    const [deployer, alice, bob, carol, relayer, feeEstimator] = await viem.getWalletClients()


    describe("Token", async function () {
        it("make 10 accounts in parallel", async function () {
            const ADDED_BITS_SECURITY = 10n;
            const POW_BITS = ADDED_BITS_SECURITY * 2n; //  ADDED_BITS_SECURITY*2 because PoW is only added to burn address, so problem only becomes half as hard
            // 2^(intSize-POW_BITS)-1;
            const POW_DIFFICULTY = 2n ** (256n - POW_BITS) - 1n//16n ** (64n - POW_LEADING_ZEROS) - 1n;

            const poseidon2Create2Salt = padHex("0x00", { size: 32 })
            await deployPoseidon2Huff(publicClient, deployer, poseidon2Create2Salt)
            const leanIMTPoseidon2 = await viem.deployContract(leanIMTPoseidon2ContractName, [], { libraries: {} });
            const ZKTranscriptLib = await viem.deployContract(ZKTranscriptLibContractName100, [], { libraries: {} });
            const reMintVerifier3 = await viem.deployContract(reMint3InVerifierContractName, [], { client: { wallet: deployer }, libraries: { ZKTranscriptLib: ZKTranscriptLib.address } });
            const reMintVerifier32 = await viem.deployContract(reMint32InVerifierContractName, [], { client: { wallet: deployer }, libraries: { ZKTranscriptLib: ZKTranscriptLib.address } });
            const reMintVerifier100 = await viem.deployContract(reMint100InVerifierContractName, [], { client: { wallet: deployer }, libraries: { ZKTranscriptLib: ZKTranscriptLib.address } });
            //PrivateTransferVerifier = await viem.deployContract(PrivateTransferVerifierContractName, [], { client: { wallet: deployer }, libraries: { } });
            const _powDifficulty = toHex(POW_DIFFICULTY, { size: 32 })
            const _reMintLimit = RE_MINT_LIMIT
            const _maxTreeDepth = MAX_TREE_DEPTH
            const _isCrossChain = false
            const _tokenName = "TWRP"
            const _tokenSymbol = "zkTransWarpTestToken"
            const _712Version = "1"
            const _verifiers = [
                { contractAddress: reMintVerifier3.address, size: 3 },
                { contractAddress: reMintVerifier32.address, size: 32 },
                { contractAddress: reMintVerifier100.address, size: 100 }
            ]
            const _acceptedChainIds: bigint[] = []

            const transwarpToken = await viem.deployContract(
                TransWarpTokenContractName,
                [
                    _powDifficulty,
                    _reMintLimit,
                    _maxTreeDepth,
                    _isCrossChain,
                    _tokenName,
                    _tokenSymbol,
                    _712Version,
                    _verifiers,
                    _acceptedChainIds
                ],

                {
                    client: { wallet: deployer },
                    libraries: { leanIMTPoseidon2: leanIMTPoseidon2.address }
                },
            )

            const alicePrivate = new BurnWallet(alice, { archiveNodes: { [await publicClient.getChainId()]: publicClient } })
            const amountBurnAddresses = 10

            const start = Date.now()
            const burnAccounts = await alicePrivate.createBurnAccountsBulk(transwarpToken.address, amountBurnAddresses, { async: true })
            console.log(`took ${Date.now() - start}ms to create: ${burnAccounts.length} burn accounts with difficulty of: ${Number(POW_BITS)} bits`)
        })
    })


})