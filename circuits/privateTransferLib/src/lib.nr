use dep::poseidon::poseidon2::Poseidon2;
//use dep::poseidon::{poseidon};

//use dep::keccak256::keccak256;
use dep::std::field::{bytes32_to_field, bn254::{
    //assert_lt, 
    gt
}};
use binary_merkle_root::binary_merkle_root;

// domain separators
global PRIVATE_ADDRESS_TYPE: Field = 0x5a4b574f524d484f4c45; // UTF8("ZKWORMHOLE").toHex() [...new TextEncoder().encode("zkwormhole")].map(b=>b.toString(16)).join('')
global TOTAL_RECEIVED_DOMAIN: Field = 0x52454345495645445F544F54414C; // UTF8("total_received").toHex()
global TOTAL_SPENT_DOMAIN: Field = 0x5350454E545F544F54414C; // UTF8("total_spent").toHex()
// @TODO find out what number would be secure enough!
// const POW_LEADING_ZEROS = 3n;
// const POW_DIFFICULTY    = 16n ** (64n - POW_LEADING_ZEROS) - 1n;
//global POW_DIFFICULTY: Field =  0x000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;//0x000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff // find a nonce that result in a hash that is hash < POW_DIFFICULTY

global MAX_TREE_DEPTH: u32 = 40;

fn merkle_hasher(leaves: [Field; 2]) -> Field {
    Poseidon2::hash(leaves, 2)
}

fn merkle_hash_root(
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

// blinding_pow acts both as a PoW to make finding a hash collision between EOA and BurnAddress harder
// and a blinding nonce, so that if pub_key is share publicly, no-one can find the burn addresses linked to it
fn get_private_address(pub_key: Field, blinding_pow: Field ) -> Field {
    let address_hash: Field = Poseidon2::hash([pub_key,blinding_pow, PRIVATE_ADDRESS_TYPE], 3);
    // @WARNING
    // Here is some disabled code for a PoW, we can later use blinding_pow as a PoW that is derived by the sender to also be a PoW
    // let pow_hash: Field = Poseidon2::hash([blinding_pow, address_hash], 2); 
    // assert_lt(pow_hash, POW_DIFFICULTY); //"pow failed: blinding_pow results in hash that is not < POW_DIFFICULTY"

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

// account_nonce makes sure the hash is never the same even when the total_spent is not different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
fn hash_account_note(total_spent: Field, account_nonce: Field, viewing_key: Field) -> Field {
    Poseidon2::hash([total_spent, account_nonce, viewing_key, TOTAL_SPENT_DOMAIN], 4)
}

// account_nonce makes sure the hash is never the same even when the total_spent is not different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
fn hash_nullifier(account_nonce: Field, viewing_key: Field) -> Field {
    Poseidon2::hash([account_nonce, viewing_key], 2)
}

fn lower_then_or_equal(a: Field, b: Field) -> bool {
    !gt(a, b)
}

pub struct SignatureData {
    pub public_key_x: [u8; 32],
    pub public_key_y: [u8; 32],
    pub signature: [u8; 64],
}

pub struct MerkleData {
    depth: u32,
    // TODO maybe we can save on memory computing indices on the spot instead?
    indices: [u1; MAX_TREE_DEPTH],
    siblings: [Field; MAX_TREE_DEPTH],
}


pub struct BurnDataPublic {
    account_note_hash: Field,       
    account_note_nullifier: Field,                   
}

pub struct BurnDataPrivate {                
    //-----very privacy sensitive data -----
    total_received: Field,              
    prev_total_spent: Field,                           
    prev_account_nonce: Field,               
    prev_account_note_merkle: MerkleData,
    total_received_merkle: MerkleData,
    amount: Field,
    blinding_pow: Field,
}

pub fn spendFromBurnAddresses(
    //public
    root: Field, 
    total_to_spent: Field, 
    burn_data_public: [BurnDataPublic],
    //private
    burn_data_private: [BurnDataPrivate],
    pub_key_x_field: Field,      
    viewing_key: Field,
    amount_burn_addresses: u32
) {
    let mut total_verified: Field = 0;
    for i in 0..burn_data_private.len() {
        if( i < amount_burn_addresses) {
            spendFromBurnAddress(
                //public
                root,
                burn_data_public[i].account_note_hash,
                burn_data_public[i].account_note_nullifier,

                //private
                pub_key_x_field,
                viewing_key,
                burn_data_private[i].amount,
                burn_data_private[i].total_received,
                burn_data_private[i].prev_total_spent,
                burn_data_private[i].blinding_pow,
                burn_data_private[i].prev_account_nonce,
                burn_data_private[i].prev_account_note_merkle,
                burn_data_private[i].total_received_merkle,
            );

            total_verified = total_verified + burn_data_private[i].amount;

        }
    }

    assert(total_verified == total_to_spent, "aggregated burn address amounts do not match amount");
}

pub fn spendFromBurnAddress(
    root: Field,
    account_note_hash: Field,
    account_note_nullifier: Field,

    pub_key_x_field: Field,
    viewing_key: Field,

    amount: Field,
    total_received: Field,
    prev_total_spent: Field,
    blinding_pow: Field,
    prev_account_nonce: Field,
    prev_account_note_merkle: MerkleData,
    total_received_merkle: MerkleData
) {
    let private_address: Field = get_private_address(pub_key_x_field, blinding_pow);

    // verify how much is "burned"
    let total_received_leaf: Field = hash_total_received_leaf(private_address, total_received);
    let root_total_received: Field = merkle_hash_root(total_received_leaf, total_received_merkle);
    assert(root_total_received == root, "total_received merkle proof invalid");

    if prev_account_nonce != 0 {
        // verify how much was spent in total before this tx: verify prev_total_spent
        let prev_account_note_hash: Field = hash_account_note(prev_total_spent, prev_account_nonce, viewing_key);
        let computed_prev_root: Field = merkle_hash_root(prev_account_note_hash, prev_account_note_merkle);
        assert(computed_prev_root == root, "prev account note merkle proof invalid");
    } else {
        // we have to skip merkle proofs since a previous spent balance does not exist

        // this assert prevents you from effectively burning money on the first tx
        assert(prev_total_spent == 0, "prev_account_nonce = 0 but prev_total_spent is not 0.");
    }

    // nullify the prev_total_spent, which is inside prev_account_note_hash and tied to prev_account_nonce + viewing_key
    let computed_nullifier: Field = hash_nullifier(prev_account_nonce, viewing_key);
    assert(computed_nullifier == account_note_nullifier, "nullifier mismatch");

    // check amount spent
    let new_spent_amount: Field = prev_total_spent + amount;
    assert(lower_then_or_equal(new_spent_amount, total_received), "spend exceeds total received");

    //
    let current_account_nonce: Field = prev_account_nonce + 1;
    let computed_account_note_hash: Field = hash_account_note(new_spent_amount, current_account_nonce, viewing_key);
    assert(computed_account_note_hash == account_note_hash, "account note hash mismatch");

}