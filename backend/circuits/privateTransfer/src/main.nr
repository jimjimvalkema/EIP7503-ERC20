use dep::poseidon::poseidon2::Poseidon2;
use dep::keccak256::keccak256;
use dep::std::{ field::{bytes32_to_field, bn254::{assert_lt, gt}}};
use binary_merkle_root::binary_merkle_root;

// domain separators
global PRIVATE_ADDRESS_TYPE: Field = 0x5a4b574f524d484f4c45; // UTF8("ZKWORMHOLE").toHex() [...new TextEncoder().encode("zkwormhole")].map(b=>b.toString(16)).join('')
global TOTAL_RECEIVED_DOMAIN: Field = 0x52454345495645445F544F54414C; // UTF8("total_received").toHex()
global TOTAL_SPENT_DOMAIN: Field = 0x5350454E545F544F54414C; // UTF8("total_spent").toHex()
// @TODO find out what number would be secure enough!
// const POW_LEADING_ZEROS = 3n;
// const POW_DIFFICULTY    = 16n ** (64n - POW_LEADING_ZEROS) - 1n;
global POW_DIFFICULTY: Field =  0x000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;//0x000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff // find a nonce that result in a hash that is hash < POW_DIFFICULTY

global MAX_TREE_DEPTH: u32 = 40;

global ETH_SIGN_PREFIX: [u8; 28] = [25,69,116,104,101,114,101,117,109,32,83,105,103,110,101,100,32,77,101,115,115,97,103,101,58,10,51,50];

fn merkle_hasher(leaves: [Field; 2]) -> Field {
    Poseidon2::hash(leaves, 2)
}

fn compute_root(
    leaf: Field,
    merkle_data: MerkleData,
) -> Field {
    binary_merkle_root(
        merkle_hasher,
        leaf,
        merkle_data.depth,
        merkle_data.indices,
        merkle_data.siblings,
    )
}

fn get_private_address(pub_key: Field, shared_secret: Field ) -> Field {
    let address_hash: Field = Poseidon2::hash([pub_key,shared_secret, PRIVATE_ADDRESS_TYPE], 3);
    // Here is some disabled code for a PoW, we can later use shared_secret as a PoW that is derived by the sender to also be a PoW
    // let pow_hash: Field = Poseidon2::hash([shared_secret, address_hash], 2); 
    // assert_lt(pow_hash, POW_DIFFICULTY); //"pow failed: shared_secret results in hash that is not < POW_DIFFICULTY"

    // replace last 12 bytes with zero since address is only 20 bytes (noir doesn't support a nicer method hence whacky for loop)
    let mut address_bytes: [u8;32] = address_hash.to_be_bytes();
    for index in 0..12 {
        address_bytes[index] = 0;
    }
    
    bytes32_to_field(address_bytes)
}

fn hash_total_received_leaf(private_address: Field, total_received: Field) -> Field {
    Poseidon2::hash(
        [private_address, total_received, TOTAL_RECEIVED_DOMAIN],
        3,
    )
}

// prev_account_nonce makes sure the hash is never the same even when the total_spent is not different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
fn hash_account_note(total_spent: Field, account_nonce: Field, viewing_key: Field) -> Field {
    Poseidon2::hash([total_spent, account_nonce, viewing_key, TOTAL_SPENT_DOMAIN], 4)
}

// account_nonce makes sure the hash is never the same even when the total_spent is not different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
fn hash_nullifier(account_nonce: Field, viewing_key: Field) -> Field {
    Poseidon2::hash([account_nonce, viewing_key], 2)
}

// fn hash_signature_inputs(recipient_address: Field, amount: Field, fee_data: FeeData) -> [u8;32] {
//     Poseidon2::hash(
//         [
//             recipient_address,
//             amount,
//             fee_data.relayer_address,
//             fee_data.priority_fee,
//             fee_data.conversion_rate,
//             fee_data.max_fee,
//         ],
//         6,
//     ).to_be_bytes()
// }

fn lower_then_or_equal(a: Field, b: Field) -> bool {
    !gt(a, b)
}

struct SignatureData {
    public_key_x: [u8; 32],
    public_key_y: [u8; 32],
    signature: [u8; 64],
}

// struct FeeData {
//     // relayerAddress = 0 <= self relay, relayerAddress = 1 <= msg.sender will relay, all other will send it to that address like expected
//     relayer_address: Field,
//     // there is no way for the contract to know what priority fee is set so the spender just has to set it for the relayer (who ofc can choose a different number)
//     priority_fee: Field,
//     // gas usage can change in network upgrades or when the merkle tree grows deeper
//     // price of eth in fee_token * gas_used
//     conversion_rate: Field,
//     // in the contract the fee is calculated feeAmountInFeeToken = (pubInput.priority_fee + block.baseFee) * pubInput.conversion_rate
//     // and should feeAmountInFeeToken < max_fee.
//     // conversionRate = gasUsage*tokenPriceInWei*relayerBonusFactor. ex gasUsage=45000,tokenPriceInEth=0.048961448,relayerBonusFactor=10%
//     // conversionRate = 45000 * 48955645000000000 * 1.1
//     max_fee: Field,
//     // fee_token is not that interesting rn because it really can only be the token it self,
//     // but in the future where it is integrated as a deposit method of a rail-gun like system it can be use full.
//     fee_token: Field,
// }

struct MerkleData {
    depth: u32,
    indices: [u1; MAX_TREE_DEPTH],
    siblings: [Field; MAX_TREE_DEPTH],
}


struct BurnAddressProofData {
    amount: Field
    account_note_hash: Field,       
    account_note_nullifier: Field, 
    root: Field,                    
    //-----very privacy sensitive data -----
    pub_key_x_field: Field,
    signature_data: SignatureData,      
    shared_secret: Field,               
    total_received: Field,              
    prev_total_spent: Field,            
    viewing_key: Field,                 
    prev_account_nonce: Field,               
    prev_account_note_merkle: MerkleData,
    total_received_merkle: MerkleData,
}

pub fn spendFromBurnAddresses(
    amount:Field,
    burnAddressProofData: BurnAddressProofData[]
) {
    let mut total_spend = 0;
    for index in 0 .. burnAddressProofData.len {
        // TODO maybe we need to watch out for overflows here. 
        total_spend += burnAddressProofData[index].amount;
        spendFromBurnAddress(
            burnAddressProofData[index].amount
            burnAddressProofData[index].account_note_hash,
            burnAddressProofData[index].account_note_nullifier,
            burnAddressProofData[index].root,                    
            burnAddressProofData[index].pub_key_x_field,
            burnAddressProofData[index].signature_data,    
            burnAddressProofData[index].shared_secret,         
            burnAddressProofData[index].total_received,          
            burnAddressProofData[index].prev_total_spent,           
            burnAddressProofData[index].viewing_key,          
            burnAddressProofData[index].prev_account_nonce,               
            burnAddressProofData[index].prev_account_note_merkle,
            burnAddressProofData[index].total_received_merkle,
        )
    } 
    assert(total_spend==amount, "resulting total_spend from all aggregated burn addresses does not match up with amount send in this tx");   
}


pub spendFromBurnAddress(
    amount: Field
    account_note_hash: Field,       
    account_note_nullifier: Field, 
    root: Field,                    
    //-----very privacy sensitive data -----
    pub_key_x_field: Field,
    signature_data: SignatureData,      
    shared_secret: Field,               
    total_received: Field,              
    prev_total_spent: Field,            
    viewing_key: Field,                 
    prev_account_nonce: Field,               
    prev_account_note_merkle: MerkleData,
    total_received_merkle: MerkleData,
) {
    let private_address: Field = get_private_address(pub_key_x_field, shared_secret);
    let total_received_leaf: Field = hash_total_received_leaf(private_address, total_received);

    // calculate the root from the merkle proof and assert it is the same as `root`
    let root_total_received: Field = compute_root(total_received_leaf,total_received_merkle);
    assert(
        root_total_received == root,
        "given root doesn't match computed root_private_addr from the private_address merkle proof",
    );

    //--------prev_total_spent------------
    if (prev_account_nonce != 0) {
        // verify that the prev_total_spent exist onchain with a merkle proof
        let prev_account_note_hash: Field = hash_account_note(prev_total_spent, prev_account_nonce, viewing_key);
        let computed_prev_account_note_root: Field = compute_root(prev_account_note_hash,prev_account_note_merkle); 
        assert(
            computed_prev_account_note_root == root,
            "given root doesn't match computed root_prev_account_note_hash from the prev_nullifier merkle proof",
        );
    } else {
        // in this case it's the first spend so there is no note_hash to prove inclusion of
        // redundant check but can prevent user burning funds on their first spend
        assert(prev_total_spent == 0, "prev_account_nonce is zero but prev_total_spent isn't")
    }
    // ----- nullify the prev note -------------
    // note: at prev_account_nonce=0 we nullify even though no pre prev_account_note exists, 
    // in this case we nullify the "first spend event" so the first spend cant happen again
    let computed_nullifier: Field = hash_nullifier(prev_account_nonce, viewing_key);
    assert(computed_nullifier == account_note_nullifier, "computed_nullifier doesn't match the account_note_nullifier");

    // ----- create new account_note-------------
    // @WARNING TODO watch out for overflows (solution?: make sure max supply of coin is < FIELD_LIMIT inside contract)
    let new_spent_amount: Field = amount + prev_total_spent;
    assert(
        lower_then_or_equal(new_spent_amount, total_received),
        "amount too large, new_spend_amount is larger than total_received",
    );
    let current_account_nonce: Field = prev_account_nonce+1;
    let computed_account_note_hash: Field = hash_account_note(new_spent_amount, current_account_nonce, viewing_key);
    assert(
        computed_account_note_hash == account_note_hash,
        "public input: computed_account_note_hash, doesn't match the one computed in the circuit",
    );
}
