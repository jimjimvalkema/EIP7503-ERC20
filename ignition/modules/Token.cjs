const { buildModule } = require("@nomicfoundation/hardhat-ignition/modules");

module.exports = buildModule("TokenModule", (m) => {
  const merkleTreeDepth = m.getParameter("merkleTreeDepth");
  const privateTransferLimit = m.getParameter("privateTransferLimit");
  const PoseidonT3Address = m.getParameter("PoseidonT3Address");
  const PoseidonT4Address = m.getParameter("PoseidonT4Address");
  const _poseidonT3 = m.contractAt("PoseidonT3", PoseidonT3Address)

  const privateTransferVerifier = m.contract("privateTransferVerifier", [], {
    value: 0n,
  });

  const token = m.contract("Token", [privateTransferLimit, merkleTreeDepth,privateTransferVerifier], {
    value: 0n,
    token
  });
  return { token };
});