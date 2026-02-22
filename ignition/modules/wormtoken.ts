import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
//@ts-ignore hardhat ignition does not understand file extensions
import { leanIMTPoseidon2ContractName,ZKTranscriptLibContractName2in, ZKTranscriptLibContractName100in, WormholeTokenContractName, PrivateTransfer2InVerifierContractName, PrivateTransfer100InVerifierContractName } from "../../src/constants.ts";

export default buildModule("wormholeToken", (m) => {
    const leanIMTPoseidon2 = m.contract(leanIMTPoseidon2ContractName, [], { libraries: {} });
    //const ZKTranscriptLib100in = m.contract(ZKTranscriptLibContractName100in, [], { libraries: {} });
    const ZKTranscriptLib2in = m.contract(ZKTranscriptLibContractName2in, [], { libraries: {} });
    const PrivateTransfer2inVerifier = m.contract(PrivateTransfer2InVerifierContractName, [], { libraries: { ZKTranscriptLib: ZKTranscriptLib2in }  });
    const PrivateTransfer100InVerifier = m.contract(PrivateTransfer100InVerifierContractName, [], { libraries: { ZKTranscriptLib: ZKTranscriptLib2in }  });
    const wormholeToken = m.contract(WormholeTokenContractName, [PrivateTransfer2inVerifier, PrivateTransfer100InVerifier], { libraries: { leanIMTPoseidon2: leanIMTPoseidon2 } });

    return { wormholeToken, PrivateTransferVerifier: PrivateTransfer2inVerifier, ZKTranscriptLib: ZKTranscriptLib2in, leanIMTPoseidon2  };
});