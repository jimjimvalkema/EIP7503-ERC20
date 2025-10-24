// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0

pragma solidity ^0.8.23;

//import "../../circuits/zkwormholesEIP7503/contract/zkwormholesEIP7503/plonk_vk.sol";
import {ERC20WithWormHoleMerkleTree} from "./ERC20WithWormHoleMerkleTree.sol"; // from openzeppelin 5.2.0 but _updateMerkleTree is added inside _update. In order to make it track incoming balances of the recipient in a merkle tree
// import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
// import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
// import {LazyIMT, LazyIMTData} from "@zk-kit/lazy-imt.sol/LazyIMT.sol";



interface IVerifier {
    function verify(
        bytes calldata _proof,
        bytes32[] calldata _publicInputs
    ) external view returns (bool);
}

error VerificationFailed();
event PrivateTransfer(uint256 indexed nullifierKey, uint256 amount);
event StorageRootAdded(uint256 blockNumber);

contract Token is ERC20WithWormHoleMerkleTree {
    // @notice nullifierKey = poseidon(nonce, secret)
    // @notice nullifierValue = poseidon(amountSpent, nonce, secret)
    mapping (uint256 => uint256) public nullifiers; // nullifierKey -> nullifierValue 

    mapping (address => uint40) private accountIndexes;
    mapping (uint256 => bool) public roots;
    uint40 currentLeafIndex;
    //LazyIMTData public merkleTreeData;


    // privateTransferVerifier doesn't go down the full 248 depth (32 instead) of the tree but is able to run with noir js (and is faster)
    address public privateTransferVerifier;


    /** 
     * EIP7503 reintroduces an attack vector with address collisions. This time its with EOAs and ZKwormhole addresses. 
     * This allows the attacker to find a address that is both a EOA and a zkwormhole address. Which allows the hacker to mint infinite tokens.
     * The cost for this attack is estimated to be 10 billion dollars in 2021.
     * This contract enforces a maximum balance zkwormhole accounts can spend to make this attack uneconomical.
     * more info here: https://hackmd.io/Vzhp5YJyTT-LhWm_s0JQpA and here: https://eips.ethereum.org/EIPS/eip-3607
     */
    uint256 public privateTransferLimit;

    /**
     * _privateTransferLimit caps the amount of tokens that are able to be spend from a private address
     */
    constructor(uint256 _privateTransferLimit, uint8 _merkleTreeDepth, address _privateTransferVerifier)
        ERC20WithWormHoleMerkleTree("zkwormholes-token", "WRMHL")
    {
        privateTransferVerifier = _privateTransferVerifier;
        privateTransferLimit = _privateTransferLimit;
        //LazyIMT.init(merkleTreeData, _merkleTreeDepth);
    }

    function getAccountLeafIndex(address _account) public view returns(uint40) {
        // -1 we store index + 1, because mappings default to 0 if a key doesn't exist.
        return accountIndexes[_account]-1;
    }

    function _hashAccountLeaf(address _account, uint256 balance) private pure returns(uint256) {
        //return PoseidonT4.hash([uint256(uint160(_account)), balance ,uint256(0x61646472657373)]); //0x61646472657373 = utf8(address) => hexadecimal
    }

    function _updateBalanceInMerkleTree(address _account, uint256 _newBalance) override internal {
        
        //TODO
        // check if account == tx.origin or if its a contract, since in that case it's not a private address.
        // tx.origin is always a EOA
        if (tx.origin == _account || _account.code.length > 0) {return;}
        
        // @WARNING you might be tempted to create smarter ways to check if its for sure not a private address. 
        // Example: store the tx.origin address somewhere in a mapping like "allKnownEOAs" to check to save gas on future transfers. 
        // Registering your EOA in "allKnownEOAs" now saves you on gas in the future. But that creates perverse incentives that break plausible deniability.
        // doing so will cause every EOA to register in "allKnownEOAs" and then there is no plausible deniability left since it now "looks weird" to not do that.
        // Even doing account != contract is bad in that sense.
        
        // hash leaf

        // uint256 leaf = _hashAccountLeaf(_account, _newBalance);
        // uint40 accountIndex = accountIndexes[_account];
        // if (accountIndex == 0 ) {
        //     LazyIMT.insert(merkleTreeData, leaf);
        //     currentLeafIndex += 1;
        //     accountIndexes[_account] = currentLeafIndex; // after currentLeafIndex += 1 because accountIndexes returns index+1 
        // } else {
        //     LazyIMT.update(merkleTreeData, leaf, accountIndex-1);
        // }
    }


    // // TODO remove debug // WARNING anyone can mint
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    //---------------public---------------------
    function privateTransfer(address to, uint256 amount, uint256 blockNum, uint256 nullifierKey, uint256 nullifierValue, bytes calldata snarkProof) public {
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
    function _formatPublicInputs(address to, uint256 amount, uint256 root, uint256 nullifierKey, uint256 nullifierValue) public pure returns (bytes32[] memory) {
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

    function _privateTransfer(address to, uint256 amount, uint256 root, uint256 nullifierKey, uint256 nullifierValue, bytes calldata snarkProof, address _verifier) private {
        //require(nullifiers[nullifier] == false, "private address already used");
        require(nullifiers[nullifierKey] == uint256(0), "nullifier already exist");
        nullifiers[nullifierKey] = nullifierValue;

        // @workaround
        //blockhash() is fucking use less :,(
        //bytes32 blkhash = blockhash(blockNum);

        // @TODO
        // @WARNING
        // check that root exitst!!!

        bytes32[] memory publicInputs = _formatPublicInputs(to, amount, root, nullifierKey, nullifierValue);
        if (!IVerifier(_verifier).verify(snarkProof, publicInputs)) {
            revert VerificationFailed();
        }

        _update(address(0), to, amount);
        emit PrivateTransfer(nullifierKey, amount);
    }
}