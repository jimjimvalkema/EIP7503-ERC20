import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
//@ts-ignore hardhat ignition does not understand file extensions
import { leanIMTPoseidon2ContractName, ZKTranscriptLibContractName2, WormholeTokenContractName, RE_MINT_LIMIT, ZKTranscriptLibContractName100, reMint2InVerifierContractName, reMint32InVerifierContractName, reMint100InVerifierContractName } from "../../src/constants.ts";
import { POW_DIFFICULTY } from "../../src/constants.ts";
import { toHex } from "viem";

export default buildModule("wormholeToken", (m) => {
    const leanIMTPoseidon2 = m.contract(leanIMTPoseidon2ContractName, [], { libraries: {} });
    //const ZKTranscriptLib100in = m.contract(ZKTranscriptLibContractName100in, [], { libraries: {} });
    const ZKTranscriptLib2in = m.contract(ZKTranscriptLibContractName2, [], { libraries: {} });
    //const ZKTranscriptLib100in = m.contract(ZKTranscriptLibContractName100in, [], { libraries: {} });
    const ReMintVerifier2 = m.contract(reMint2InVerifierContractName, [], { libraries: { ZKTranscriptLib: ZKTranscriptLib2in } });
    const ReMintVerifier32 = m.contract(reMint32InVerifierContractName, [], { libraries: { ZKTranscriptLib: ZKTranscriptLib2in } });
    const ReMintVerifier100 = m.contract(reMint100InVerifierContractName, [], { libraries: { ZKTranscriptLib: ZKTranscriptLib2in } });
    const wormholeToken = m.contract(
        WormholeTokenContractName,
        [
            [
                {contractAddress:ReMintVerifier2, size:2},
                {contractAddress:ReMintVerifier32, size:32},
                {contractAddress:ReMintVerifier100, size:100}
            ]
            ,
            toHex(POW_DIFFICULTY, { size: 32 }), 
            RE_MINT_LIMIT
        ],
        { libraries: { leanIMTPoseidon2: leanIMTPoseidon2 } }
    );

    return { wormholeToken, PrivateTransfer2inVerifier: ReMintVerifier2, ReMintVerifier32, ReMintVerifier100, ZKTranscriptLib: ZKTranscriptLib2in, leanIMTPoseidon2 };
});