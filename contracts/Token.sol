// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0

pragma solidity ^0.8.23;

//import "../../circuits/zkwormholesEIP7503/contract/zkwormholesEIP7503/plonk_vk.sol";
import {ERC20} from "./ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

interface IVerifier {
    function verify(
        bytes calldata _proof,
        bytes32[] calldata _publicInputs
    ) external view returns (bool);
}

error VerificationFailed();
event PrivateTransfer(bytes32 indexed nullifierKey, uint256 amount);
event StorageRootAdded(uint256 blockNumber);

contract Token is ERC20, Ownable {
    // @notice nullifierKey = poseidon(nonce, secret)
    // @notice nullifierValue = poseidon(amountSpent, nonce, secret)
    mapping (bytes32 => bytes32) public nullifiers; // nullifierKey -> nullifierValue 

    // privateTransferVerifier doesnt go down the full 248 depth (32 instead) of the tree but is able to run witn noir js (and is faster)
    address public privateTransferVerifier;

    /** 
     * EIP7503 reintroduces an attack vector with address collisions. This time its with EOAs and ZKwormhole addresses. 
     * This allows the attacker to find a address that is both a EOA and a zkwormhole address. Which allows the hacker to mint infinite tokens.
     * The cost for this attack is estimated to be 10 billion dollars in 2021.
     * This contract enforces a maximum balance zkwormhole accounts can spend to make this attack uneconomical.
     * more info here: https://hackmd.io/Vzhp5YJyTT-LhWm_s0JQpA and here: https://eips.ethereum.org/EIPS/eip-3607
     */
    uint256 public privateTransferLimit;

    constructor(uint256 _privateTransferLimit, uint8 _merkleTreeDepth, address _privateTransferVerifier)
        ERC20("zkwormholes-token", "WRMHL")
        Ownable(msg.sender)
    {
        privateTransferVerifier = _privateTransferVerifier;
    }

    // // TODO remove debug // WARNING anyone can mint
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    //---------------public---------------------
    function privateTransfer(address to, uint256 amount, uint256 blockNum, bytes32 nullifierKey, bytes32 nullifierValue, bytes calldata snarkProof) public {
        _privateTransfer( to,  amount,  blockNum, nullifierKey, nullifierValue, snarkProof,  privateTransferVerifier);
    }

    // verifier wants the [u8;32] (bytes32 array) as bytes32[32] array.
    // ex: bytes32[32] array = ['0x0000000000000000000000000000000000000000000000000000000000000031','0x0000000000000000000000000000000000000000000000000000000000000027',etc]
    // but fields can be normal bytes32
    // all public inputs are put into a flattened array
    // so in our case array = [Field + bytes32, bytes32 + Field]. which the lenght will be: 1 + 32 + 32 = 66
    //TODO make private
    // TODO see much gas this cost and if publicInputs can be calldata
    // does bit shifting instead of indexing save gas?
    function _formatPublicprivateTransferInputs(address to, uint256 amount, uint256 root, uint256 nullifierKey, uint256 nullifierValue) public pure returns (bytes32[] memory) {
        bytes32 amountBytes = bytes32(uint256(amount));
        bytes32 toBytes = bytes32(uint256(uint160(bytes20(to))));
        bytes32[] memory publicInputs = new bytes32[](5);

        publicInputs[0] = toBytes;
        publicInputs[1] = amountBytes;
        publicInputs[2] = bytes32(nullifierValue);
        publicInputs[3] = bytes32(nullifierKey);
        publicInputs[4] = bytes32(root);

        return publicInputs;
    }

    function _formatPublicStorageRootInputs(bytes32 storageRoot, bytes32 blockHash, address contractAddress) public pure returns(bytes32[] memory) {
        bytes32[] memory publicInputs = new bytes32[](65);
        publicInputs[0] = storageRoot;
        bytes20 contractAddressBytes = bytes20(contractAddress);

        for (uint i=1; i < 33; i++) {
            publicInputs[i] = bytes32(uint256(uint8(blockHash[i-1])));
        }

        // only copy first 20 bytes, rest can stay zero
        for (uint i=33; i < 53; i++) {
            publicInputs[i] = bytes32(uint256(uint8(contractAddressBytes[i-33])));
        }
        return publicInputs;
    }

    function _privateTransfer(address to, uint256 amount, uint256 root, bytes32 nullifierKey, bytes32 nullifierValue, bytes calldata snarkProof, address _verifier) private {
        //require(nullifiers[nullifier] == false, "private address already used");
        require(nullifiers[nullifierKey] == bytes32(0x0), "nullifier already exist");
        nullifiers[nullifierKey] = nullifierValue;

        // @workaround
        //blockhash() is fucking use less :,(
        //bytes32 blkhash = blockhash(blockNum);

        // @TODO
        // @WARNING
        // check that root exitst!!!

        bytes32[] memory publicInputs = _formatPublicprivateTransferInputs(to, amount, root, nullifierKey, nullifierValue);
        if (!IVerifier(_verifier).verify(snarkProof, publicInputs)) {
            revert VerificationFailed();
        }
        unchecked {
            // Overflow not possible: balance + value is at most totalSupply, which we know fits into a uint256.
            _balances[to] += amount;
        }
        emit Transfer(address(0), to, amount);
        emit PrivateTransfer(nullifierKey, amount);
    }
}