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
    indices: [u1; MAX_TREE_DEPTH],
    siblings: [Field; MAX_TREE_DEPTH],
}


pub struct BurnAddressPublicProofData {
    account_note_hash: Field,       
    account_note_nullifier: Field,                   
}

pub struct BurnAddressPrivateProofData {                
    //-----very privacy sensitive data -----
    total_received: Field,              
    prev_total_spent: Field,                           
    prev_account_nonce: Field,               
    prev_account_note_merkle: MerkleData,
    total_received_merkle: MerkleData,
    amount: Field,
    shared_secret: Field,
}

pub fn spendFromBurnAddresses(
    root: Field, 
    amount: Field, 
    burn_address_public_proof_data: [BurnAddressPublicProofData],
    //private
    pub_key_x_field: Field,      
    viewing_key: Field,
    burn_address_private_proof_data: [BurnAddressPrivateProofData],
    amount_burn_addresses: u32
) {
    let mut total_spend: Field = 0;
    for i in 0..burn_address_private_proof_data.len() {
        if( i < amount_burn_addresses) {
            let public_data: BurnAddressPublicProofData = burn_address_public_proof_data[i];
            let private_data: BurnAddressPrivateProofData = burn_address_private_proof_data[i];
            spendFromBurnAddress(
                //public
                root,
                private_data.amount,
                public_data.account_note_hash,
                public_data.account_note_nullifier,

                //private
                pub_key_x_field,    
                private_data.shared_secret,
                viewing_key,

                private_data.total_received,
                private_data.prev_total_spent,
                private_data.prev_account_nonce,
                private_data.prev_account_note_merkle,
                private_data.total_received_merkle,
            );

            total_spend = total_spend + private_data.amount;

        }
    }

    assert(total_spend == amount, "aggregated burn address amounts do not match target amount");
}

pub fn spendFromBurnAddress(
    root: Field,
    amount: Field,
    account_note_hash: Field,
    account_note_nullifier: Field,

    pub_key_x_field: Field,
    shared_secret: Field,
    viewing_key: Field,

    total_received: Field,
    prev_total_spent: Field,
    prev_account_nonce: Field,
    prev_account_note_merkle: MerkleData,
    total_received_merkle: MerkleData
) {
    let private_address: Field = get_private_address(pub_key_x_field, shared_secret);
    let total_received_leaf: Field = hash_total_received_leaf(private_address, total_received);

    let root_total_received: Field = compute_root(total_received_leaf, total_received_merkle);
    assert(root_total_received == root, "total_received merkle proof invalid");

    if prev_account_nonce != 0 {
        let prev_account_note_hash: Field = hash_account_note(prev_total_spent, prev_account_nonce, viewing_key);
        let computed_prev_root: Field = compute_root(prev_account_note_hash, prev_account_note_merkle);
        assert(computed_prev_root == root, "prev account note merkle proof invalid");
    } else {
        assert(prev_total_spent == 0, "first spend but prev_total_spent != 0");
    }

    let computed_nullifier: Field = hash_nullifier(prev_account_nonce, viewing_key);
    assert(computed_nullifier == account_note_nullifier, "nullifier mismatch");

    let new_spent_amount: Field = prev_total_spent + amount;
    assert(lower_then_or_equal(new_spent_amount, total_received), "spend exceeds total received");

    let current_account_nonce: Field = prev_account_nonce + 1;
    let computed_account_note_hash: Field = hash_account_note(new_spent_amount, current_account_nonce, viewing_key);
    assert(computed_account_note_hash == account_note_hash, "account note hash mismatch");
}