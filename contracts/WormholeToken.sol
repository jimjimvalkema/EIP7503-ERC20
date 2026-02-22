// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0


// @TODO 
pragma solidity ^0.8.3;

import {ERC20WithWormHoleMerkleTree} from "./ERC20WithWormHoleMerkleTree.sol"; 
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {LeanIMTData, Hasher} from "zk-kit-lean-imt-custom-hash/InternalLeanIMT.sol";
import {leanIMTPoseidon2} from "./leanIMTPoseidon2.sol";
import {IVerifier} from "./privateTransfer2InVerifier.sol";

struct FeeData {
    uint256 tokensPerEthPrice;
    uint256 maxFee; 
    uint256 amountForRecipient;
    uint256 relayerBonus;
    uint256 estimatedGasCost; 
    uint256 estimatedPriorityFee;
    address refundAddress;
    address relayerAddress;
}

struct SignatureInputs {
    address recipient;
    uint256 amountToReMint;
    bytes callData;
    bool callCanFail;
    uint256 callValue;
    bytes[] encryptedTotalSpends;
}


error VerificationFailed();
// accountNoteNullifier is indexed so users can search for it and find out the total amount spend, which is needed to make the next spend the next spent
// the nullifiers mapping contains the blockNumber it was nullified at. This can be used for a faster syncing strategy
event Nullified(uint256 indexed nullifier, bytes encryptedTotalSpends);
event StorageRootAdded(uint256 blockNumber);
event NewLeaf(uint256 leaf);

contract WormholeToken is ERC20WithWormHoleMerkleTree, EIP712 {
    // this is so leafs from received balance and spent balance wont get mixed up
    uint256 constant public TOTAL_BURNED_DOMAIN = 0x544f54414c5f4255524e4544; //  UTF8("TOTAL_BURNED").toHex()
    address internal constant POSEIDON2_ADDRESS = 0x382ABeF9789C1B5FeE54C72Bd9aaf7983726841C; // yul-recompile-200: 0xb41072641808e6186eF5246fE1990e46EB45B65A gas: 62572, huff: 0x382ABeF9789C1B5FeE54C72Bd9aaf7983726841C gas:39 627, yul-lib: 0x925e05cfb89f619BE3187Bf13D355A6D1864D24D,

    // @notice accountNoteNullifier = poseidon(nonce, viewingKey)
    // @notice accountNoteHash = poseidon(totalAmountSpent, nonce, viewingKey)
    mapping (uint256 => uint256) public nullifiers; // accountNoteNullifier -> blockNumber
    mapping (uint256 => bool) public roots;

    uint40 currentLeafIndex;

    uint256 public amountFreeTokens = 1000000*10**decimals();
    uint256 public decimalsTokenPrice = 8;

    address public privateTransferVerifier2In;
    address public privateTransferVerifier100In;
    LeanIMTData public tree;
    
    /**
     * 
     */
    constructor(address _privateTransferVerifier2In, address _privateTransferVerifier100In)
        ERC20WithWormHoleMerkleTree("zkwormholes-token", "WRMHL")
        EIP712("zkwormholes-token", "1") 
    {
        privateTransferVerifier2In = _privateTransferVerifier2In;
        privateTransferVerifier100In = _privateTransferVerifier100In;
    }

    function treeSize() public view  returns (uint256) {
        return tree.size;
    }

    bytes32 private constant _RE_MINT_TYPEHASH =
        keccak256(
            "privateReMint(address _recipient,uint256 _amount,bytes _callData,bool _callCanFail,uint256 _callValue,bytes[] _encryptedTotalSpends)"
        );

    bytes32 private constant _RE_MINT_RELAYER_TYPEHASH =
        keccak256(
            "privateReMintRelayer(address _recipient,uint256 _amount,bytes _callData,bool _callCanFail,uint256 _callValue,bytes[] _encryptedTotalSpends,FeeData _feeData)FeeData(uint256 tokensPerEthPrice,uint256 maxFee,uint256 amountForRecipient,uint256 relayerBonus,uint256 estimatedGasCost,uint256 estimatedPriorityFee,address refundAddress,address relayerAddress)"
        );

    bytes32 private constant _FEEDATA_TYPEHASH = keccak256(
        "FeeData(uint256 tokensPerEthPrice,uint256 maxFee,uint256 amountForRecipient,uint256 relayerBonus,uint256 estimatedGasCost,uint256 estimatedPriorityFee,address refundAddress,address relayerAddress)"
    );

    function _hashBytesArray(bytes[] memory items) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](items.length);
        for (uint256 i = 0; i < items.length; i++) {
            hashes[i] = keccak256(items[i]);
        }
        return keccak256(abi.encodePacked(hashes));
    }

    function _hashFeeData(FeeData memory _feeData) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            _FEEDATA_TYPEHASH,
            _feeData.tokensPerEthPrice,
            _feeData.maxFee,
            _feeData.amountForRecipient,
            _feeData.relayerBonus,
            _feeData.estimatedGasCost,
            _feeData.estimatedPriorityFee,
            _feeData.refundAddress,
            _feeData.relayerAddress
        ));
    }

    function _hashSignatureInputs(
        SignatureInputs calldata _signatureInputs
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                _RE_MINT_TYPEHASH,
                _signatureInputs.recipient,
                _signatureInputs.amountToReMint,
                keccak256(_signatureInputs.callData),
                _signatureInputs.callCanFail,
                _signatureInputs.callValue,
                _hashBytesArray(_signatureInputs.encryptedTotalSpends)
            )
        );
        return _hashTypedDataV4(structHash);
    }

    function _hashSignatureInputsRelayer(
        SignatureInputs calldata _signatureInputs,
        FeeData calldata _feeData
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                _RE_MINT_RELAYER_TYPEHASH,
                _signatureInputs.recipient,
                _signatureInputs.amountToReMint,
                keccak256(_signatureInputs.callData),
                _signatureInputs.callCanFail,
                _signatureInputs.callValue,
                _hashBytesArray(_signatureInputs.encryptedTotalSpends),
                _hashFeeData(_feeData)
            )
        );
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
        input[2] = TOTAL_BURNED_DOMAIN;
        return hashPoseidon2T3(input);
    }

    function _insertInMerkleTree(uint256 leaf) internal {
        leanIMTPoseidon2.insert(tree, leaf);
        emit NewLeaf(leaf);
        roots[leanIMTPoseidon2.root(tree)] = true;
    }

    function _insertManyInMerkleTree(uint256[] memory leafs) override internal {
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
        // Example: check that `_to` is an smart contract (_to.code.length > 0) or store the tx.origin address somewhere in a mapping like "allKnownEOAs" to check to save gas on future transfers. 
        // Registering your EOA in "allKnownEOAs" / using smart contract accounts saves you on gas in the future. But that creates perverse incentives that break plausible deniability.
        // doing so will cause every EOA owner to register in "allKnownEOAs" / use smart contract accounts and then there is no plausible deniability left since it's now "looks weird" to not do that.
        // Even doing account != contract is bad in that sense. Since account based wallets would also save on gas.
        

        uint256 leaf = hashBalanceLeaf(_to, _newBalance);

        if (leanIMTPoseidon2.has(tree,leaf)) {
            // it's already in there! (rarely happens but can happen if an EOA receives an amount that results in a balance it had before)
            return;
        } else {
            _insertInMerkleTree(leaf);
        }
    }

    function _updateBalanceInMerkleTree(address _to, uint256 _newBalance, uint256[] memory _accountNoteHashes) override internal {        
        // check if account == tx.origin since in that case it's not a private address.
        // and we only need to insert _accountNoteHash
        // tx.origin is always a EOA
        if (tx.origin == _to ) {
            _insertManyInMerkleTree(_accountNoteHashes);
        } else {
            uint256 accountBalanceLeaf = hashBalanceLeaf(_to, _newBalance);

            if (leanIMTPoseidon2.has(tree,accountBalanceLeaf)) {
                // accountBalanceLeaf is already in there! so we only insert _accountNoteHash
                // note: _accountNoteHash is always unique, remember it is poseidon(totalSpend,viewingKey,nonce)
                _insertManyInMerkleTree( _accountNoteHashes);
            } else {
                uint256[] memory leafs = new uint256[](1+_accountNoteHashes.length);
                leafs[0] = accountBalanceLeaf;
                for (uint i = 0; i < _accountNoteHashes.length; i++) {
                    leafs[i+1] = _accountNoteHashes[i];
                }
                _insertManyInMerkleTree(leafs);
            }
        }
    }

    function _updateBalanceInMerkleTree(address[] memory _accounts, uint256[] memory _newBalances, uint256[] memory _accountNoteHashes) override internal {        
        // check if account == tx.origin since in that case it's not a private address.
        // and we only need to insert _accountNoteHash
        // tx.origin is always a EOA
        uint256[] memory leafs = new uint256[](_accounts.length + _accountNoteHashes.length);

        uint256 leafsIndex = 0;
        for (uint256 i = 0; i < _accounts.length; i++) {
            if (tx.origin != _accounts[i]) {
                uint256 accountBalanceLeaf = hashBalanceLeaf(_accounts[i], _newBalances[i]);
                // only happens when someone receives an amount that exactly adds up to a balance that results a balance that had before
                // very rare don't really want to check for this but leanIMT wont allow me to insert the same leaf twice
                if(leanIMTPoseidon2.has(tree,accountBalanceLeaf)) {
                    leafs[leafsIndex++] = accountBalanceLeaf;
                }
            }
        }

        for (uint256 i = 0; i < _accountNoteHashes.length; i++) {
            leafs[leafsIndex++] = _accountNoteHashes[i];
        }

        // Trim array to actual length
        assembly { mstore(leafs, leafsIndex) }

        _insertManyInMerkleTree(leafs);
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
        uint256 _root,
        uint256 _amount,
        bytes32 _signatureHash,
        uint256[] memory _accountNoteHashes,        // a commitment inserted in the merkle tree, tracks how much is spend after this transfer hash(prev_total_spent+amount, prev_account_nonce, viewing_key)
        uint256[] memory _accountNoteNullifiers   // nullifies the previous account_note.  hash(prev_account_nonce, viewing_key)
    ) public pure returns (bytes32[] memory) {
        if (_accountNoteHashes.length == 2) {
            bytes32[] memory publicInputs = new bytes32[](34 + 2*2);

            publicInputs[0] = bytes32(_root);
            publicInputs[1] = bytes32(uint256(_amount));
            uint256 signatureHashOffset = 2;
            for (uint256 i = 0; i < 32; i++) {
                publicInputs[i + signatureHashOffset] = bytes32(uint256(uint8(_signatureHash[i])));
            }

            uint256 noteHashesOffSet = 32 + signatureHashOffset;
            for (uint256 i = 0; i < _accountNoteHashes.length ; i++) {
                publicInputs[2 * i + noteHashesOffSet] = bytes32(_accountNoteHashes[i]);
                publicInputs[2 * i + noteHashesOffSet + 1] = bytes32(_accountNoteNullifiers[i]);
            }

            return publicInputs;

        } else if (_accountNoteHashes.length == 100) {
            bytes32[] memory publicInputs = new bytes32[](34 + 100*2);

            publicInputs[0] = bytes32(_root);
            publicInputs[1] = bytes32(uint256(_amount));
            uint256 signatureHashOffset = 2;
            for (uint256 i = 0; i < 32; i++) {
                publicInputs[i + signatureHashOffset] = bytes32(uint256(uint8(_signatureHash[i])));
            }

            uint256 noteHashesOffSet = 32 + signatureHashOffset;
            for (uint256 i = 0; i < _accountNoteHashes.length ; i++) {
                publicInputs[2 * i + noteHashesOffSet] = bytes32(_accountNoteHashes[i]);
                publicInputs[2 * i + noteHashesOffSet + 1] = bytes32(_accountNoteNullifiers[i]);
            }

            return publicInputs;
        } else {
            revert("amount of note hashes not supported");
        }

    }


    function _verifyReMint(
        uint256 _amount,
        uint256[] memory _accountNoteHashes,         // a commitment inserted in the merkle tree, tracks how much is spend after this transfer hash(prev_total_spent+amount, prev_account_nonce, viewing_key)
        uint256[] memory _accountNoteNullifiers,     // nullifies the previous account_note.  hash(prev_account_nonce, viewing_key)
        uint256 _root,
        bytes calldata _snarkProof,
        bytes[] calldata _encryptedTotalSpends,
        bytes32 signatureHash
    ) public {
        require(roots[_root], "invalid root");
        // check and store nullifiers, emit Nullified events with _encryptedTotalSpends blobs
        for (uint256 i = 0; i < _accountNoteNullifiers.length; i++) {
            uint256 _accountNoteNullifier = _accountNoteNullifiers[i];
            require(nullifiers[_accountNoteNullifier] == uint256(0), "nullifier already exist");
            nullifiers[_accountNoteNullifier] = block.number;
            emit Nullified(_accountNoteNullifier, _encryptedTotalSpends[i]); 
        }

        // format public inputs and verify proof 
        bytes32[] memory publicInputs = _formatPublicInputs(_root, _amount, signatureHash, _accountNoteHashes, _accountNoteNullifiers);
        if (_accountNoteNullifiers.length == 2) {
            if (!IVerifier(privateTransferVerifier2In).verify(_snarkProof, publicInputs)) {
                revert VerificationFailed();
            }
        } else if (_accountNoteNullifiers.length == 100) {
            if (!IVerifier(privateTransferVerifier100In).verify(_snarkProof, publicInputs)) {
                revert VerificationFailed();
            }
        } else {
            revert("amount of note hashes not supported");
        }
    }

    function privateReMint(
        uint256[] memory _accountNoteHashes,         // a commitment inserted in the merkle tree, tracks how much is spend after this transfer hash(prev_total_spent+amount, prev_account_nonce, viewing_key)
        uint256[] memory _accountNoteNullifiers,     // nullifies the previous account_note.  hash(prev_account_nonce, viewing_key)
        uint256 _root,
        bytes calldata _snarkProof,
        SignatureInputs calldata _signatureInputs
    ) public {
        bytes32 _signatureHash = _hashSignatureInputs(_signatureInputs);
        _verifyReMint(_signatureInputs.amountToReMint, _accountNoteHashes, _accountNoteNullifiers, _root, _snarkProof, _signatureInputs.encryptedTotalSpends, _signatureHash);
        
        // modified version of _mint that also inserts noteHashes and does not modify total supply!
        _reMint(_signatureInputs.recipient, _signatureInputs.amountToReMint, _accountNoteHashes);
        _processCall(_signatureInputs);
    }

    function _calculateFee(FeeData calldata _feeData, uint256 _amountToReMint) public view returns(uint256,uint256) {
        uint256 _feeInWei =  _feeData.estimatedGasCost * (block.basefee + _feeData.estimatedPriorityFee);
        uint256 _fee = ((_feeInWei * _feeData.tokensPerEthPrice) / 10**decimalsTokenPrice) + _feeData.relayerBonus;
        require(_fee < _feeData.maxFee, "relayer fee is too high");
        require(_amountToReMint > _fee, "fee is more then amount being reMinted");
        require((_amountToReMint - _fee) >= _feeData.amountForRecipient , "not enough left after fees for recipient");
        uint256 _refundAmount = _feeData.maxFee - _fee;
        return (_fee, _refundAmount);
    }

    function privateReMintRelayer(
        uint256[] memory _accountNoteHashes,         // a commitment inserted in the merkle tree, tracks how much is spend after this transfer hash(prev_total_spent+amount, prev_account_nonce, viewing_key)
        uint256[] memory _accountNoteNullifiers,     // nullifies the previous account_note.  hash(prev_account_nonce, viewing_key)
        uint256 _root,
        bytes calldata _snarkProof,
        SignatureInputs calldata _signatureInputs,
        FeeData calldata _feeData
    ) public {
        (uint256 _fee, uint256 _refundAmount) = _calculateFee(_feeData, _signatureInputs.amountToReMint);
        bytes32 _signatureHash = _hashSignatureInputsRelayer(_signatureInputs, _feeData);
        _verifyReMint(_signatureInputs.amountToReMint, _accountNoteHashes, _accountNoteNullifiers, _root, _snarkProof, _signatureInputs.encryptedTotalSpends, _signatureHash);

        // optional let anyone claim the fee
        address relayerAddress;
        if (_feeData.relayerAddress == address(1)) {
            relayerAddress = msg.sender;
        } else {
            relayerAddress = _feeData.relayerAddress;
        }

        // giga ugly solidity array bs :/
        address[] memory recipients = new address[](3);
        recipients[0] = _signatureInputs.recipient;
        recipients[1] = _feeData.refundAddress;
        recipients[2] = relayerAddress;
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = _feeData.amountForRecipient;
        amounts[1] = _refundAmount;
        amounts[2] = _fee;
        _reMintBulk(recipients, amounts, _accountNoteHashes);
        _processCall(_signatureInputs);
    }

    function _processCall(SignatureInputs calldata _signatureInputs) private {
        if (_signatureInputs.callData.length != 0 || _signatureInputs.callValue > 0) { 
            (bool success,) = _signatureInputs.recipient.call{value:_signatureInputs.callValue}(_signatureInputs.callData);
            require(_signatureInputs.callCanFail || success, "call failed and was not allowed to fail");
        }
    }
}