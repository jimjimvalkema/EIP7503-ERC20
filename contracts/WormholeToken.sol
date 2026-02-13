// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0


// @TODO 
pragma solidity ^0.8.3;

import {ERC20WithWormHoleMerkleTree} from "./ERC20WithWormHoleMerkleTree.sol"; 
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {LeanIMTData, Hasher} from "zk-kit-lean-imt-custom-hash/InternalLeanIMT.sol";
import {leanIMTPoseidon2} from "./leanIMTPoseidon2.sol";
import {IVerifier} from "./privateTransfer2InVerifier.sol";

// struct FeeData {
//     // relayerAddress = 0 <= self relay, relayerAddress = 1 <= msg.sender will relay, all other will send it to that address like expected
//     address relayerAddress;
//     // there is no way for the contract to know what priority fee is set so the spender just has to set it for the relayer (who ofc can choose a different number)
//     uint256 priorityFee;
//     // gas usage can change in network upgrades or when the merkle tree grows deeper
//     // price of eth in fee_token * gas_used
//     uint256 conversionRate;
//     // in the contract the fee is calculated feeAmountInFeeToken = (pubInput.priority_fee + block.baseFee) * pubInput.conversion_rate
//     // and should feeAmountInFeeToken < max_fee. conversionRate = gasUsage*tokenPriceInWei*relayerBonusFactor. 
//     // ex gasUsage=45000,tokenPriceInEth=0.048961448,relayerBonusFactor=10%
//     // conversionRate = 45000 * 48955645000000000 * 1.1
//     uint256 maxFee;
//     // fee_token is not that interesting rn because it really can only be the token it self or eth,
//     // but in the future where it is integrated as a deposit method of a rail-gun like system it can be use full.
//     // address feeToken;
// }



error VerificationFailed();
// accountNoteNullifier is indexed so users can search for it and find out the total amount spend, which is needed to make the next spend the next spent
// the nullifiers mapping contains the blockNumber it was nullified at. This can be used for a faster syncing strategy
event Nullified(uint256 indexed nullifier, bytes totalSpentEncrypted);
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

    address public privateTransferVerifier1In;
    address public privateTransferVerifier4In;
    LeanIMTData public tree;
    
    /**
     * 
     */
    constructor(address _privateTransferVerifier1In, address _privateTransferVerifier4In)
        ERC20WithWormHoleMerkleTree("zkwormholes-token", "WRMHL")
        EIP712("zkwormholes-token", "1") 
    {
        privateTransferVerifier1In = _privateTransferVerifier1In;
        privateTransferVerifier4In = _privateTransferVerifier4In;
    }

    function treeSize() public view  returns (uint256) {
        return tree.size;
    }

    bytes32 private constant _REMINT_TYPEHASH =
        keccak256(
            "privateReMint(address _recipientAddress,uint256 _amount,bytes _callData,bytes[] _totalSpentEncrypted)"
        );

    function _hashBytesArray(bytes[] memory items) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](items.length);
        for (uint256 i = 0; i < items.length; i++) {
            hashes[i] = keccak256(items[i]);
        }
        return keccak256(abi.encodePacked(hashes));
    }

    function _hashSignatureInputs(
        address _recipientAddress,
        uint256 _amount,
        bytes memory _callData,
        bytes[] memory _totalSpentEncrypted
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                _REMINT_TYPEHASH,                     // 1. typehash first
                _recipientAddress,                    // 2. address encodes directly
                _amount,                              // 3. uint256 encodes directly
                keccak256(_callData),                 // 4. bytes → keccak256
                _hashBytesArray(_totalSpentEncrypted) // 5. bytes[] → hash each, then pack & hash
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
            _insertManyInMerkleTree( _accountNoteHashes);
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
            bytes32[] memory publicInputs = new bytes32[](38);

            publicInputs[0] = bytes32(_root);
            publicInputs[1] = bytes32(uint256(_amount));
            uint256 signatureHashOffset = 2;
            for (uint256 i = 0; i < 32; i++) {
                publicInputs[i + signatureHashOffset] = bytes32(uint256(uint8(_signatureHash[i])));
            }
            publicInputs[34] = bytes32(_accountNoteHashes[0]);
            publicInputs[35] = bytes32(_accountNoteNullifiers[0]);
            publicInputs[36] = bytes32(_accountNoteHashes[1]);
            publicInputs[37] = bytes32(_accountNoteNullifiers[1]);

            return publicInputs;

        } else if (_accountNoteHashes.length == 4) {
            bytes32[] memory publicInputs = new bytes32[](42);

            publicInputs[0] = bytes32(_root);
            publicInputs[1] = bytes32(uint256(_amount));
            uint256 signatureHashOffset = 2;
            for (uint256 i = 0; i < 32; i++) {
                publicInputs[i + signatureHashOffset] = bytes32(uint256(uint8(_signatureHash[i])));
            }
            publicInputs[34] = bytes32(_accountNoteHashes[0]);
            publicInputs[35] = bytes32(_accountNoteNullifiers[0]);
            publicInputs[36] = bytes32(_accountNoteHashes[1]);
            publicInputs[37] = bytes32(_accountNoteNullifiers[1]);
            publicInputs[38] = bytes32(_accountNoteHashes[2]);
            publicInputs[39] = bytes32(_accountNoteNullifiers[2]);
            publicInputs[40] = bytes32(_accountNoteHashes[3]);
            publicInputs[41] = bytes32(_accountNoteNullifiers[3]);

            return publicInputs;
        } else {
            revert("amount of note hashes not supported");
        }

    }

    // function _calculateFees(FeeData calldata _feeData, uint256 _amount) private view returns(uint256, uint256) {
    //     require(_feeData.feeToken == address(this), "alternative payment tokens is not implemented yet");
    //     uint256 _relayerReward = (_feeData.priorityFee + block.basefee) * _feeData.conversionRate;
    //     uint256 _recipientAmount = _amount - _relayerReward;
    //     assert(_feeData.maxFee >= _relayerReward);
    //     return (_relayerReward, _recipientAmount);
    // }

    function privateReMint(
        uint256 _amount,
        address _to,
        uint256[] memory _accountNoteHashes,         // a commitment inserted in the merkle tree, tracks how much is spend after this transfer hash(prev_total_spent+amount, prev_account_nonce, viewing_key)
        uint256[] memory _accountNoteNullifiers,     // nullifies the previous account_note.  hash(prev_account_nonce, viewing_key)
        uint256 _root,
        bytes calldata _snarkProof,
        bytes calldata _callData,
        bytes[] calldata _totalSpentEncrypted      
    ) public {
        // @notice this has the side effect of burned balances not being spendable of a for of ethereum on a different chainId.
        // long term we might need to research a different identifier
        uint256 blockNumber = block.number;
        for (uint256 i = 0; i < _accountNoteNullifiers.length; i++) {
            uint256 _accountNoteNullifier = _accountNoteNullifiers[i];
            require(nullifiers[_accountNoteNullifier] == uint256(0), "nullifier already exist");
            nullifiers[_accountNoteNullifier] = blockNumber;
            emit Nullified(_accountNoteNullifier, _totalSpentEncrypted[i]); 
        }
        
        require(roots[_root], "invalid root");
        bytes32 signatureHash = _hashSignatureInputs(_to, _amount, _callData, _totalSpentEncrypted);
        //@jimjim technically _feeData doesn't need to be here. It can be in a contract that handles that
        // @TODO make relayer contract!!!
        // if (_feeData.relayerAddress == address(0)) {
        //     //-- self relay --
        //     // inserts _accountNoteHash into the merkle tree as well
        //     _privateReMint(_to, _amount, _accountNoteHashes);
        // } else {
        //     //-- use relayer --
        //     address rewardRecipient = _feeData.relayerAddress;
        //     if (_feeData.relayerAddress == address(1)) {
        //         // this enables ex block builder to permissionlessly relay the tx
        //         rewardRecipient = msg.sender;
        //     }
        //     (uint256 _relayerReward,uint256 _recipientAmount) = _calculateFees(_feeData, _amount);
        //      // inserts _accountNoteHash into the merkle tree as well
        //     _privateReMint(_to, _recipientAmount, _accountNoteHashes);
        //     // @note this can cause a separate insert here that could be more efficient with insert many. But in most cases tx.origin == relayerAddress so not worth to optimize this.
        //     _update(address(0), _feeData.relayerAddress, _relayerReward);
        // }

        bytes32[] memory publicInputs = _formatPublicInputs(_root, _amount, signatureHash, _accountNoteHashes, _accountNoteNullifiers);
        if (_accountNoteNullifiers.length == 2) {
            if (!IVerifier(privateTransferVerifier1In).verify(_snarkProof, publicInputs)) {
                revert VerificationFailed();
            }
        } else if (_accountNoteNullifiers.length == 4) {
            if (!IVerifier(privateTransferVerifier4In).verify(_snarkProof, publicInputs)) {
                revert VerificationFailed();
            }
        } else {
            revert("amount of note hashes not supported");
        }

        _privateReMint(_to, _amount, _accountNoteHashes);

    }
}