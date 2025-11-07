import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
//@ts-ignore hardhat ignition does not understand file extensions
import { leanIMTPoseidon2ContractName, ZKTranscriptLibContractName, PrivateTransferVerifierContractName, WormholeTokenContractName } from "../../src/constants";

export default buildModule("wormholeToken", (m) => {
    const leanIMTPoseidon2 = m.contract(leanIMTPoseidon2ContractName, [], { libraries: {} });
    const ZKTranscriptLib = m.contract(ZKTranscriptLibContractName, [], { libraries: {} });
    const PrivateTransferVerifier = m.contract(PrivateTransferVerifierContractName, [], { libraries: { ZKTranscriptLib: ZKTranscriptLib }  });
    const wormholeToken = m.contract(WormholeTokenContractName, [PrivateTransferVerifier], { libraries: { leanIMTPoseidon2: leanIMTPoseidon2 } });

    return { wormholeToken, PrivateTransferVerifier, ZKTranscriptLib, leanIMTPoseidon2  };
});