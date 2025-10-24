// const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

// module.exports = buildModule("TokenModule", (m) => {
//   const merkleTreeDepth = m.getParameter("merkleTreeDepth");

//   // TODO leanIMTPoseidon2
//   const privateTransferVerifier = m.contract("privateTransferVerifier", [], {
//     value: 0n,
//   });

//   const token = m.contract("Token", [privateTransferLimit, merkleTreeDepth,privateTransferVerifier], {
//     value: 0n,
//     token
//   });
//   return { token, privateTransferVerifier };
// });