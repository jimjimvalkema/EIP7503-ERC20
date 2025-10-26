// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0

pragma solidity ^0.8.23;

//import "../../circuits/zkwormholesEIP7503/contract/zkwormholesEIP7503/plonk_vk.sol";
import {ERC20WithWormHoleMerkleTree} from "./ERC20WithWormHoleMerkleTree.sol"; // from openzeppelin 5.2.0 but _updateMerkleTree is added inside _update. In order to make it track incoming balances of the recipient in a merkle tree
// import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
// import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
// import {LazyIMT, LazyIMTData} from "@zk-kit/lazy-imt.sol/LazyIMT.sol";
import {leanIMTPoseidon2} from "./leanIMTPoseidon2.sol";
import {LeanIMTData, Hasher} from "zk-kit-lean-imt-custom-hash/InternalLeanIMT.sol";


interface IVerifier {
    function verify(
        bytes calldata _proof,
        bytes32[] calldata _publicInputs
    ) external view returns (bool);
}


struct FeeData {
    address relayerAddress;
    // there is no way for the contract to know what priority fee is set so the spender just has to set it for the relayer (who ofc can choose a different number)
    uint256 priorityFee;
    // gas usage can change in network upgrades or when the merkle tree grows deeper
    // price of eth in fee_token * gas_used
    uint256 conversionRate;
    // in the contract the fee is calculated feeAmountInFeeToken = (pubInput.priority_fee + block.baseFee) * pubInput.conversion_rate
    // and should feeAmountInFeeToken < max_fee
    uint256 maxFee;
    // fee_token is not that interesting rn because it really can only be the token it self or eth,
    // but in the future where it is integrated as a deposit method of a rail-gun like system it can be use full.
    address feeToken;
}

error VerificationFailed();
// 
event PrivateTransfer(uint256 indexed accountNoteNullifier, uint256 amount);
event StorageRootAdded(uint256 blockNumber);
event NewLeaf(uint256 leaf);

contract WormholeToken is ERC20WithWormHoleMerkleTree {
    address internal constant POSEIDON2_ADDRESS = 0x382ABeF9789C1B5FeE54C72Bd9aaf7983726841C; // yul-recompile-200: 0xb41072641808e6186eF5246fE1990e46EB45B65A gas: 62572, huff: 0x382ABeF9789C1B5FeE54C72Bd9aaf7983726841C gas:39 627, yul-lib: 0x925e05cfb89f619BE3187Bf13D355A6D1864D24D,

    // @notice accountNoteNullifier = poseidon(nonce, secret)
    // @notice accountNoteHash = poseidon(amountSpent, nonce, secret)
    mapping (uint256 => uint256) public nullifiers; // accountNoteNullifier -> amount spend 

    mapping (address => uint40) private accountIndexes;
    mapping (uint256 => bool) public roots;
    uint40 currentLeafIndex;

    uint256 public amountFreeTokens = 1000000*10**decimals();


    // privateTransferVerifier doesn't go down the full 248 depth (32 instead) of the tree but is able to run with noir js (and is faster)
    address public privateTransferVerifier;
    LeanIMTData public tree;
    
    /**
     * 
     */
    constructor(address _privateTransferVerifier)
        ERC20WithWormHoleMerkleTree("zkwormholes-token", "WRMHL")
    {
        privateTransferVerifier = _privateTransferVerifier;
    }

    // The function used for hashing the balanceLeaf
    function hashBalanceLeaf(uint256[2] memory input) public view returns (uint256) {
        (, bytes memory result) = POSEIDON2_ADDRESS.staticcall(abi.encode(input));
        return uint256(bytes32(result));
    }

    function _insertInMerkleTree(uint256 leaf) override internal {
        leanIMTPoseidon2.insert(tree, leaf);
    }

    function _updateBalanceInMerkleTree(address _to, uint256 _newBalance) override internal {        
        // TODO
        // check if account == tx.origin or if its a contract, since in that case it's not a private address.
        // tx.origin is always a EOA
        if (tx.origin == _to || _to.code.length > 0) {return;}
        
        // @WARNING you might be tempted to create smarter ways to check if its for sure not a private address. 
        // Example: store the tx.origin address somewhere in a mapping like "allKnownEOAs" to check to save gas on future transfers. 
        // Registering your EOA in "allKnownEOAs" now saves you on gas in the future. But that creates perverse incentives that break plausible deniability.
        // doing so will cause every EOA owner to register in "allKnownEOAs" and then there is no plausible deniability left since it now "looks weird" to not do that.
        // Even doing account != contract is bad in that sense. Since account based wallets would also save on gas.
        

        uint256 leaf = hashBalanceLeaf([_addressToUint256(_to), _newBalance]);

        if (leanIMTPoseidon2.has(tree,leaf)) {
            // it's already in there! (rarely happens but can happen if an EOA receives an amount that results in a balance it had before)
            return;
        } else {
            leanIMTPoseidon2.insert(tree,leaf);
            roots[leanIMTPoseidon2.root(tree)] = true;
            emit NewLeaf(leaf);
        }
    }

    function _updateBalanceInMerkleTree(address _to, uint256 _newBalance, uint256 _accountNoteHash) override internal {        
        // check if account == tx.origin or if its a contract, since in that case it's not a private address.
        // and we only need to insert _accountNoteHash
        // tx.origin is always a EOA
        if (tx.origin == _to || _to.code.length > 0) {
            leanIMTPoseidon2.insert(tree,_accountNoteHash);
        } else {
            uint256 accountBalanceLeaf = hashBalanceLeaf([_addressToUint256(_to), _newBalance]);

            if (leanIMTPoseidon2.has(tree,accountBalanceLeaf)) {
                // accountBalanceLeaf is already in there! so we only insert _accountNoteHash
                // note: _accountNoteHash is always unique, remember it is poseidon(totalSpend,viewingKey,nonce)
                leanIMTPoseidon2.insert(tree, _accountNoteHash);
            } else {
                uint256[] memory inserts = new uint256[](2);
                inserts[0] = accountBalanceLeaf;
                inserts[1] = _accountNoteHash;
                leanIMTPoseidon2.insertMany(tree, inserts);
                roots[leanIMTPoseidon2.root(tree)] = true;
                emit NewLeaf(accountBalanceLeaf);
            }
        }
    }

    function root() public view returns(uint256){
        return leanIMTPoseidon2.root(tree);
    }

    // @WARNING remove this in prod, anyone can mint for free!
    function getFreeTokens(address _to) public {
        _mint(_to, amountFreeTokens);
    }


    function _addressToUint256(address _address) private pure returns (uint256) {
        return uint256(uint160(bytes20(_address)));
    }

    function _formatPublicInputs(
        uint256 _amount,
        address _to,
        FeeData calldata _feeData,
        uint256 _accountNoteHash,        // a commitment inserted in the merkle tree, tracks how much is spend after this transfer hash(prev_spent_total+amount, account_nonce, viewing_key)
        uint256 _accountNoteNullifier,   // nullifies the previous account_note.  hash(account_nonce, viewing_key)
        uint256 _root
    ) public pure returns (bytes32[] memory) {
        bytes32[] memory publicInputs = new bytes32[](5);

        publicInputs[0] = bytes32(uint256(_amount));
        publicInputs[1] = bytes32(_addressToUint256(_to));
        //-- feeData --
        publicInputs[3] = bytes32(_addressToUint256(_feeData.relayerAddress));
        publicInputs[4] = bytes32(_feeData.priorityFee);
        publicInputs[5] = bytes32(_feeData.conversionRate);
        publicInputs[6] = bytes32(_feeData.maxFee);
        publicInputs[7] = bytes32(_addressToUint256(_feeData.feeToken));
        //------------
        publicInputs[8] = bytes32(_accountNoteHash);
        publicInputs[9] = bytes32(_accountNoteNullifier);
        publicInputs[10] = bytes32(_root);

        return publicInputs;
    }

    function _privateTransfer(
        uint256 _amount,
        address _to,
        FeeData calldata _feeData,
        uint256 _accountNoteHash,        // a commitment inserted in the merkle tree, tracks how much is spend after this transfer hash(prev_spent_total+amount, account_nonce, viewing_key)
        uint256 _accountNoteNullifier,   // nullifies the previous account_note.  hash(account_nonce, viewing_key)
        uint256 _root,
        bytes calldata _snarkProof,
        address _verifier
    ) private {
        require(nullifiers[_accountNoteNullifier] == uint256(0), "nullifier already exist");
        require(roots[_root], "invalid root");
        nullifiers[_accountNoteNullifier] = _amount;

        bytes32[] memory publicInputs = _formatPublicInputs(_amount,_to, _feeData, _accountNoteHash, _accountNoteNullifier, _root);
        if (!IVerifier(_verifier).verify(_snarkProof, publicInputs)) {
            revert VerificationFailed();
        }

        // inserts _accountNoteHash into the merkle tree as well
        _privateReMint(_to, _amount, _accountNoteHash);
        emit PrivateTransfer(_accountNoteNullifier, _amount);
    }
}