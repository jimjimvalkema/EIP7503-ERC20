import assert from "node:assert/strict";
import { beforeEach, describe, it, after } from "node:test";

import { network } from "hardhat";

// TODO fix @warptoad/gigabridge-js why it doesn't automatically gets @aztec/aztec.js
import { deployPoseidon2Huff } from "@warptoad/gigabridge-js"

import { FIELD_LIMIT, WormholeTokenContractName, PrivateTransfer2InVerifierContractName, leanIMTPoseidon2ContractName, ZKTranscriptLibContractName100in, PrivateTransfer100InVerifierContractName, POW_DIFFICULTY } from "../src/constants.js";
import { getSyncedMerkleTree } from "../src/syncing.js";
//import { noir_test_main_self_relay, noir_verify_sig } from "../src/noirtests.js";
import { getBackend } from "../src/proving.js";
import type { ContractReturnType } from "@nomicfoundation/hardhat-viem/types";
import { proofAndSelfRelay, safeBurn, superSafeBurn } from "../src/transact.js";
import type { BurnAccount, UnsyncedBurnAccount } from "../src/types.js";
import { PrivateWallet } from "../src/PrivateWallet.js";
import { getContract, padHex, parseEventLogs, toHex, type Hash, type Hex } from "viem";

describe("Token", async function () {
    const { viem } = await network.connect();
    const publicClient = await viem.getPublicClient();
    const [deployer, alice, bob, carol, relayer, feeEstimator] = await viem.getWalletClients()


    describe("Token", async function () {
        it("make 10 accounts in parallel", async function () {
            const ADDED_BITS_SECURITY = 2n; // 88 bits total, ~2.0s (max ~8s) pow time , $2.6 trillion attack cost ($10b * 2**(16/2)), 
            const POW_BITS = ADDED_BITS_SECURITY*2n; //  ADDED_BITS_SECURITY*2 because PoW is only added to burn address, so problem only becomes half as hard
            // 2^(intSize-POW_BITS)-1;
            const POW_DIFFICULTY = 2n**(256n-POW_BITS)-1n//16n ** (64n - POW_LEADING_ZEROS) - 1n;
            
            const alicePrivate = new PrivateWallet(alice, POW_DIFFICULTY, { acceptedChainIds: [BigInt(await publicClient.getChainId())]})
            const amountBurnAddresses = 10

            const burnAccounts:UnsyncedBurnAccount[] = await alicePrivate.createBurnAccounts(amountBurnAddresses,{async:true})
        })
    })


})