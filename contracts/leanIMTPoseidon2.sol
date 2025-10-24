// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import {InternalLeanIMT, LeanIMTData, Hasher} from "zk-kit-lean-imt-custom-hash/InternalLeanIMT.sol";
import {SNARK_SCALAR_FIELD} from "zk-kit-lean-imt-custom-hash/Constants.sol";

library leanIMTPoseidon2 {
    // TODO
    address internal constant POSEIDON2_ADDRESS = 0x382ABeF9789C1B5FeE54C72Bd9aaf7983726841C; // yul-recompile-200: 0xb41072641808e6186eF5246fE1990e46EB45B65A gas: 62572, huff: 0x382ABeF9789C1B5FeE54C72Bd9aaf7983726841C gas:39 627, yul-lib: 0x925e05cfb89f619BE3187Bf13D355A6D1864D24D,
    // Hasher internal constant HASHER = Hasher(_hasher, SNARK_SCALAR_FIELD); constants on types that are function is not implemented yet in solidity (caused by HASHER.func)

    // The function used for hashing. Passed as a function parameter in functions from InternalLazyIMT
    function _hasher(uint256[2] memory leaves) internal view returns (uint256) {
        (, bytes memory result) = POSEIDON2_ADDRESS.staticcall(abi.encode(leaves));
        return uint256(bytes32(result));
    }

    using InternalLeanIMT for *;

    function insert(LeanIMTData storage self, uint256 leaf) public returns (uint256) {
        return InternalLeanIMT._insert(self, leaf, Hasher(_hasher, SNARK_SCALAR_FIELD));
    }

    function insertMany(LeanIMTData storage self, uint256[] calldata leaves) public returns (uint256) {
        return InternalLeanIMT._insertMany(self, leaves, Hasher(_hasher, SNARK_SCALAR_FIELD));
    }

    function update(
        LeanIMTData storage self,
        uint256 oldLeaf,
        uint256 newLeaf,
        uint256[] calldata siblingNodes
    ) public returns (uint256) {
        return InternalLeanIMT._update(self, oldLeaf, newLeaf, siblingNodes, Hasher(_hasher, SNARK_SCALAR_FIELD));
    }

    function remove(
        LeanIMTData storage self,
        uint256 oldLeaf,
        uint256[] calldata siblingNodes
    ) public returns (uint256) {
        return InternalLeanIMT._remove(self, oldLeaf, siblingNodes, Hasher(_hasher, SNARK_SCALAR_FIELD));
    }

    function has(LeanIMTData storage self, uint256 leaf) public view returns (bool) {
        return InternalLeanIMT._has(self, leaf);
    }

    function indexOf(LeanIMTData storage self, uint256 leaf) public view returns (uint256) {
        return InternalLeanIMT._indexOf(self, leaf);
    }

    function root(LeanIMTData storage self) public view returns (uint256) {
        return InternalLeanIMT._root(self);
    }
}
