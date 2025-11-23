// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0

pragma solidity ^0.8.3;

import {ERC20WithWormHoleMerkleTree} from "./ERC20WithWormHoleMerkleTree.sol"; 
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {LeanIMTData, Hasher} from "zk-kit-lean-imt-custom-hash/InternalLeanIMT.sol";
import {leanIMTPoseidon2} from "./leanIMTPoseidon2.sol";
import {IVerifier} from "./PrivateTransferVerifier.sol";

struct FeeData {
    address relayerAddress;
    uint256 priorityFee;
    uint256 conversionRate;
    uint256 maxFee;
    address feeToken;
}



error VerificationFailed();
// accountNoteNullifier is indexed so users can search for it and find out the total amount spend, which is needed to make the next spend the next
// alternatively they can use `nullifiers` mapping
event PrivateTransfer(uint256 indexed accountNoteNullifier, uint256 amount);
event StorageRootAdded(uint256 blockNumber);
event NewLeaf(uint256 leaf);

contract WormholeToken is ERC20WithWormHoleMerkleTree, EIP712 {
    // this is so leafs from received balance and spent balance wont get mixed up
    uint256 constant public TOTAL_RECEIVED_DOMAIN = 0x52454345495645445F544F54414C; // UTF8("total_received").toHex()
    address internal constant POSEIDON2_ADDRESS = 0x382ABeF9789C1B5FeE54C72Bd9aaf7983726841C; // yul-recompile-200: 0xb41072641808e6186eF5246fE1990e46EB45B65A gas: 62572, huff: 0x382ABeF9789C1B5FeE54C72Bd9aaf7983726841C gas:39 627, yul-lib: 0x925e05cfb89f619BE3187Bf13D355A6D1864D24D,


    function debugDomain()
        external
        view
        returns (
            string memory name,
            string memory version,
            uint256 chainId,
            address verifyingContract,
            bytes32 domainSeparator
        )
    {
        name = "SchwarzSchild";
        version = "1";
        chainId = block.chainid;
        verifyingContract = address(this);
        domainSeparator = _domainSeparatorV4();
    }

    function debugPrivateTransferHash(
        address _to,
        uint256 _amount,
        FeeData calldata _feeData
    )
        external
        view
        returns (bytes32 structHash, bytes32 digest)
    {
        structHash = _hashPrivateTransfer(_to, _amount, _feeData);
        digest = _hashTypedDataV4(structHash);
    }

    bytes32 private constant _FEE_DATA_TYPEHASH =
        keccak256(
            "FeeData(address relayerAddress,uint256 priorityFee,uint256 conversionRate,uint256 maxFee,address feeToken)"
        );

    bytes32 private constant _PRIVATE_TRANSFER_TYPEHASH =
        keccak256(
            "PrivateTransfer(address to,uint256 amount,FeeData feeData)"
            "FeeData(address relayerAddress,uint256 priorityFee,uint256 conversionRate,uint256 maxFee,address feeToken)"
        );

    function _hashFeeData(FeeData calldata fee) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                _FEE_DATA_TYPEHASH,
                fee.relayerAddress,
                fee.priorityFee,
                fee.conversionRate,
                fee.maxFee,
                fee.feeToken
            )
        );
    }

        /**
         * @notice 
         * uint256 _amount,
        address _to,
        FeeData calldata _feeData,
        uint256 _accountNoteHash,        // a commitment inserted in the merkle tree, tracks how much is spend after this transfer hash(prev_total_spent+amount, prev_account_nonce, viewing_key)
        uint256 _accountNoteNullifier,   // nullifies the previous account_note.  hash(prev_account_nonce, viewing_key)
        uint256 _root,
        bytes calldata _snarkProof
         */

    // @notice accountNoteNullifier = poseidon(nonce, viewingKey)
    // @notice accountNoteHash = poseidon(totalAmountSpent, nonce, viewingKey)
    mapping (uint256 => uint256) public nullifiers; // accountNoteNullifier -> amountSpendInTx + 1 (+1 to protect nullifier logic on txs where amount is 0) 

    mapping (address => uint40) private accountIndexes;
    mapping (uint256 => bool) public roots;

    // @TODO @CLEARSING will be remove when clearsign
    bytes constant ETH_SIGN_PREFIX = hex"19457468657265756d205369676e6564204d6573736167653a0a3332";//abi.encodePacked("\x19Ethereum Signed Message:\n");    
    uint40 currentLeafIndex;

    uint256 public amountFreeTokens = 1000000*10**decimals();

    address public privateTransferVerifier;
    LeanIMTData public tree;
    
    /**
     * 
     */
    constructor(address _privateTransferVerifier)
        ERC20WithWormHoleMerkleTree("zkwormholes-token", "WRMHL")
        EIP712("SchwarzSchild", "1") 
    {
        privateTransferVerifier = _privateTransferVerifier;
    }
 
    function _getMessageWithEthPrefix(bytes32 message) public pure returns(bytes memory){
        return abi.encodePacked(ETH_SIGN_PREFIX, message);
    }

    function _hashPrivateTransfer(
        address _to,
        uint256 _amount,
        FeeData calldata _feeData
    ) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                _PRIVATE_TRANSFER_TYPEHASH,
                _to,
                _amount,
                _hashFeeData(_feeData)
            )
        );
    }

    function _hashSignatureInputs(
        address _to,
        uint256 _amount,
        FeeData calldata _feeData
    ) public view returns (bytes32) {
        bytes32 structHash = _hashPrivateTransfer(_to, _amount, _feeData);
        return _hashTypedDataV4(structHash);
    }

    function hashPoseidon2T3(uint256[3] memory input) public view returns (uint256) {
        (, bytes memory result) = POSEIDON2_ADDRESS.staticcall(abi.encode(input));
        return uint256(bytes32(result));
    }

    function hashPoseidon2T6(uint256[6] memory input) public view returns (uint256) {
        (, bytes memory result) = POSEIDON2_ADDRESS.staticcall(abi.encode(input));
        return uint256(bytes32(result));
    }

    // The function used for hashing the balanceLeaf
    function hashBalanceLeaf(address _to, uint256 _newBalance) private view returns (uint256) {
        uint256[3] memory input;
        input[0] = _addressToUint256(_to);
        input[1] = _newBalance;
        input[2] = TOTAL_RECEIVED_DOMAIN;
        return hashPoseidon2T3(input);
    }

    function _insertInMerkleTree(uint256 leaf) override internal {
        leanIMTPoseidon2.insert(tree, leaf);
        emit NewLeaf(leaf);
        roots[leanIMTPoseidon2.root(tree)] = true;
    }

    function _insertManyInMerkleTree(uint256[] memory leafs) internal {
        leanIMTPoseidon2.insertMany(tree, leafs);
        for (uint i = 0; i < leafs.length; i++) {
            emit NewLeaf(leafs[i]);
        }
        roots[leanIMTPoseidon2.root(tree)] = true;
    }


    function _updateBalanceInMerkleTree(address _to, uint256 _newBalance) override internal {        
        // tx.origin is always a EOA, so no need to do a merkle tree insertion, saves gas on defi interactions for example someone buying the token
        if (tx.origin == _to ) {return;}
        //to.code.length check is removed since it creates  perverse incentives
        //if (tx.origin == _to || _to.code.length > 0) {return;}
        
        // @WARNING you might be tempted to create smarter ways to check if its for sure not a private address. 
        // Example: check i _to is an smartcontract (_to.code.length > 0) or store the tx.origin address somewhere in a mapping like "allKnownEOAs" to check to save gas on future transfers. 
        // Registering your EOA in "allKnownEOAs" / using smartcontract accounts saves you on gas in the future. But that creates perverse incentives that break plausible deniability.
        // doing so will cause every EOA owner to register in "allKnownEOAs" / use smartcontract accounts and then there is no plausible deniability left since it's now "looks weird" to not do that.
        // Even doing account != contract is bad in that sense. Since account based wallets would also save on gas.
        

        uint256 leaf = hashBalanceLeaf(_to, _newBalance);

        if (leanIMTPoseidon2.has(tree,leaf)) {
            // it's already in there! (rarely happens but can happen if an EOA receives an amount that results in a balance it had before)
            return;
        } else {
            _insertInMerkleTree(leaf);
        }
    }

    function _updateBalanceInMerkleTree(address _to, uint256 _newBalance, uint256 _accountNoteHash) override internal {        
        // check if account == tx.origin since in that case it's not a private address.
        // and we only need to insert _accountNoteHash
        // tx.origin is always a EOA
        if (tx.origin == _to ) {
            _insertInMerkleTree( _accountNoteHash);
        } else {
            uint256 accountBalanceLeaf = hashBalanceLeaf(_to, _newBalance);

            if (leanIMTPoseidon2.has(tree,accountBalanceLeaf)) {
                // accountBalanceLeaf is already in there! so we only insert _accountNoteHash
                // note: _accountNoteHash is always unique, remember it is poseidon(totalSpend,viewingKey,nonce)
                _insertInMerkleTree( _accountNoteHash);
            } else {
                uint256[] memory leafs = new uint256[](2);
                leafs[0] = accountBalanceLeaf;
                leafs[1] = _accountNoteHash;
                _insertManyInMerkleTree(leafs);
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
        bytes32 _signatureHash,
        uint256 _accountNoteHash,        // a commitment inserted in the merkle tree, tracks how much is spend after this transfer hash(prev_total_spent+amount, prev_account_nonce, viewing_key)
        uint256 _accountNoteNullifier,   // nullifies the previous account_note.  hash(prev_account_nonce, viewing_key)
        uint256 _root
    ) public pure returns (bytes32[] memory) {
        bytes32[] memory publicInputs = new bytes32[](36);

        publicInputs[0] = bytes32(uint256(_amount));
        uint256 signatureHashOffset = 1;
        for (uint256 i = 0; i < 32; i++) {
            publicInputs[i + signatureHashOffset] = bytes32(uint256(uint8(_signatureHash[i])));
        }
        publicInputs[33] = bytes32(_accountNoteHash);
        publicInputs[34] = bytes32(_accountNoteNullifier);
        publicInputs[35] = bytes32(_root);

        return publicInputs;
    }

    function _calculateFees(FeeData calldata _feeData, uint256 _amount) private view returns(uint256, uint256) {
        require(_feeData.feeToken == address(this), "alternative payment tokens is not implemented yet");
        uint256 _relayerReward = (_feeData.priorityFee + block.basefee) * _feeData.conversionRate;
        uint256 _recipientAmount = _amount - _relayerReward;
        assert(_feeData.maxFee >= _relayerReward);
        return (_relayerReward, _recipientAmount);
    }

    function privateTransfer(
        uint256 _amount,
        address _to,
        FeeData calldata _feeData,
        uint256 _accountNoteHash,        // a commitment inserted in the merkle tree, tracks how much is spend after this transfer hash(prev_total_spent+amount, prev_account_nonce, viewing_key)
        uint256 _accountNoteNullifier,   // nullifies the previous account_note.  hash(prev_account_nonce, viewing_key)
        uint256 _root,
        bytes calldata _snarkProof
    ) public {
        require(nullifiers[_accountNoteNullifier] == uint256(0), "nullifier already exist");
        require(roots[_root], "invalid root");
        require(_feeData.maxFee <= _amount, "maxFee is larger than the amount send");
        // +1 to protect nullifier logic on txs where amount is 0
        nullifiers[_accountNoteNullifier] = _amount +1;
        bytes32 signatureHash = _hashSignatureInputs(_to, _amount, _feeData);
    
        if (_feeData.relayerAddress == address(0)) {
            //-- self relay --
            // inserts _accountNoteHash into the merkle tree as well
            _privateReMint(_to, _amount, _accountNoteHash);
            emit PrivateTransfer(_accountNoteNullifier, _amount);
        } else {
            //-- use relayer --
            address rewardRecipient = _feeData.relayerAddress;
            if (_feeData.relayerAddress == address(1)) {
                // this enables ex block builder to permissionlessly relay the tx
                rewardRecipient = msg.sender;
            }
            (uint256 _relayerReward,uint256 _recipientAmount) = _calculateFees(_feeData, _amount);
             // inserts _accountNoteHash into the merkle tree as well
            _privateReMint(_to, _recipientAmount, _accountNoteHash);
            // @note this can cause a separate insert here that could be more efficient with insert many. But in most cases tx.origin == relayerAddress so not worth to optimize this.
            _update(address(0), _feeData.relayerAddress, _relayerReward);
            emit PrivateTransfer(_accountNoteNullifier, _amount);
        }

        bytes32[] memory publicInputs = _formatPublicInputs(_amount, signatureHash, _accountNoteHash, _accountNoteNullifier, _root);
        if (!IVerifier(privateTransferVerifier).verify(_snarkProof, publicInputs)) {
            revert VerificationFailed();
        }
    }
}