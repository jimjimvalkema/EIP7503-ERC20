mod domain_separators;
use domain_separators::{BURN_ADDRESS_TYPE,TOTAL_BURNED_DOMAIN,TOTAL_SPENT_DOMAIN};

use dep::poseidon::poseidon2::Poseidon2;
//use dep::poseidon::{poseidon};

//use dep::keccak256::keccak256;
use dep::std::field::{bytes32_to_field, bn254::{
    assert_lt, 
    gt
}};
use binary_merkle_root::binary_merkle_root;


fn merkle_hasher(leaves: [Field; 2]) -> Field {
    Poseidon2::hash(leaves, 2)
}

fn merkle_hash_root<let MAX_TREE_DEPTH: u32>(
    leaf: Field,
    merkle_data: MerkleData<MAX_TREE_DEPTH>,
) -> Field {
    binary_merkle_root(
        merkle_hasher,
        leaf,
        merkle_data.depth,
        merkle_data.indices,
        merkle_data.siblings,
    )
}

// @notice chain_id is not used in this repo but can be used to make this cross-chain like warptoad
// viewing_key is there so it is committed in the burn address, 
// to prevent spenders from using a different key and pretend they never spent before when ever the create the nullifier at account_nonce=0
fn hash_blinded_burn_address_data(spending_pub_key:Field, chain_id:Field, viewing_key:Field) -> Field {
    Poseidon2::hash([spending_pub_key, viewing_key, chain_id], 3)
}

fn verify_pow(blinded_address_data_hash: Field, pow_nonce: Field, pow_difficulty: Field ) {
    let pow_hash: Field = Poseidon2::hash([blinded_address_data_hash, pow_nonce], 2); 
    assert_lt(pow_hash, pow_difficulty); //"pow failed: pow_nonce results in hash that is not < pow_difficulty"
}

// pow_nonce acts both as a PoW to make finding a hash collision between EOA and BurnAddress harder
fn hash_burn_address(blinded_address_data_hash: Field, pow_nonce: Field) -> Field {
    let address_hash: Field = Poseidon2::hash([blinded_address_data_hash, pow_nonce, BURN_ADDRESS_TYPE], 3);

    // // replace last 12 bytes with zero since a eth address is only 20 bytes (noir doesn't support a nicer method hence whacky for loop)
    let bytes: [u8; 32] = address_hash.to_be_bytes();
    let mut eth_address: Field = 0;
    for i in 12..32 {
        eth_address = eth_address * 256 + bytes[i] as Field;
    }
    eth_address
}

fn hash_total_burned_leaf(burn_address: Field, total_burned: Field) -> Field {
    Poseidon2::hash(
        [burn_address, total_burned, TOTAL_BURNED_DOMAIN],
        3,
    )
}

/*
total_spent: total_spent for that specific burn address
blinded_address_data_hash: this ties this commitment to the chain_id which is crucial for cross-chain warptoad like use cases, also ties it to the rest of the data in that hash
viewing_key: is already inside blinded_address_data_hash, but is used again here so blinded_address_data_hash is sharable so sender can create burn addresses on the recipients behave
*/
fn hash_total_spent_leaf(total_spent: Field, account_nonce: Field, blinded_address_data_hash:Field, viewing_key: Field) -> Field {
    Poseidon2::hash([total_spent, account_nonce, blinded_address_data_hash, viewing_key, TOTAL_SPENT_DOMAIN], 5)
}

// account_nonce makes sure the hash is never the same even when the total_spent is not different
// viewing_key is so others cant try and find the pre-image (since this hash is posted onchain)
// and viewing_key is also committed inside the burn address pre-image, so spender is forced to only use that viewing key. To prevent them using a new one and pretending they never spent before
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

pub struct MerkleData<let MAX_TREE_DEPTH: u32> {
    depth: u32,
    // TODO maybe we can save on memory computing indices on the spot instead?
    indices: [u1; MAX_TREE_DEPTH],
    siblings: [Field; MAX_TREE_DEPTH],
}


pub struct BurnDataPublic {
    total_spent_leaf: Field,       
    nullifier: Field,                   
}

pub struct BurnDataPrivate <let MAX_TREE_DEPTH: u32> {                
    //-----very privacy sensitive data -----
    /*blinds note hashes and nullifiers, separate from blinding_pow to support senders making fresh burn account on the recipients behave*/
    viewing_key: Field,    
    /*Serves as a PoW to defend against the address collision attack (similar problem to eip-3607) */
    pow_nonce: Field,
    // amounts
    total_burned: Field,              
    prev_total_spent: Field,  
    amount_to_spend: Field,                     
    // inclusion proof
    prev_account_nonce: Field,               
    prev_account_note_merkle_data: MerkleData<MAX_TREE_DEPTH>,
    total_burned_merkle_data: MerkleData<MAX_TREE_DEPTH>,
}

pub fn bulkReMint<let MAX_TREE_DEPTH: u32>(
    //public
    root: Field, 
    chain_id: Field,
    total_amount_to_spent: Field, 
    pow_difficulty: Field,
    re_mint_limit: Field,
    burn_data_public: [BurnDataPublic],
    //private
    burn_data_private: [BurnDataPrivate<MAX_TREE_DEPTH>],
    spending_pub_key: Field,    
    amount_burn_addresses: u32
) {
    let mut amount_verified: Field = 0;
    for i in 0..burn_data_private.len() {
        if( i < amount_burn_addresses) {
            reMint::<MAX_TREE_DEPTH>(
                //public
                root,
                chain_id,
                pow_difficulty,
                re_mint_limit,
                burn_data_public[i].total_spent_leaf,
                burn_data_public[i].nullifier,

                //private
                spending_pub_key,
                burn_data_private[i].viewing_key,
                burn_data_private[i].pow_nonce,
                burn_data_private[i].amount_to_spend,
                burn_data_private[i].total_burned,
                burn_data_private[i].prev_total_spent,
                burn_data_private[i].prev_account_nonce,
                burn_data_private[i].prev_account_note_merkle_data,
                burn_data_private[i].total_burned_merkle_data,
            );

            amount_verified = amount_verified + burn_data_private[i].amount_to_spend;

        }
    }

    assert(amount_verified == total_amount_to_spent, "aggregated burn address amounts do not match amount to spend");
}

pub fn reMint<let MAX_TREE_DEPTH: u32>(
    // public
    root: Field,
    chain_id: Field,
    pow_difficulty: Field,
    re_mint_limit: Field,
    total_spent_leaf: Field,
    nullifier: Field,

    // private, keys
    spending_pub_key: Field,
    viewing_key: Field,
    pow_nonce: Field,

    // private balances
    amount_to_spend: Field,
    total_burned: Field,
    prev_total_spent: Field,

    // private inclusion proof
    prev_account_nonce: Field,
    prev_account_note_merkle_data: MerkleData<MAX_TREE_DEPTH>,
    total_burned_merkle_data: MerkleData<MAX_TREE_DEPTH>
) {
    let blinded_address_data_hash: Field = hash_blinded_burn_address_data(spending_pub_key, chain_id, viewing_key );
    let burn_address: Field = hash_burn_address(blinded_address_data_hash, pow_nonce);
    verify_pow(blinded_address_data_hash, pow_nonce, pow_difficulty);

    // verify how much is "burned"
    let total_burned_leaf: Field = hash_total_burned_leaf(burn_address, total_burned);
    let root_total_burned_root: Field = merkle_hash_root::<MAX_TREE_DEPTH>(total_burned_leaf, total_burned_merkle_data);
    assert(root_total_burned_root == root, "total_burned merkle proof invalid");

    if prev_account_nonce != 0 {
        // verify how much was spent in total before this tx: verify prev_total_spent
        let prev_total_spent_leaf: Field = hash_total_spent_leaf(prev_total_spent, prev_account_nonce,blinded_address_data_hash, viewing_key);
        let prev_total_spend_root: Field = merkle_hash_root::<MAX_TREE_DEPTH>(prev_total_spent_leaf, prev_account_note_merkle_data);
        assert(prev_total_spend_root == root, "prev account note merkle proof invalid");
    } else {
        // we have to skip merkle proofs since a previous spent balance does not exist

        // this assert prevents you from effectively burning money on the first tx
        assert(prev_total_spent == 0, "prev_account_nonce = 0 but prev_total_spent is not 0.");
    }

    // nullify the prev_total_spent, which is inside prev_total_spent_leaf and tied to prev_account_nonce + viewing_key
    let new_nullifier: Field = hash_nullifier(prev_account_nonce, viewing_key);
    assert(new_nullifier == nullifier, "nullifier mismatch");

    // check amount spent
    let new_total_spent: Field = prev_total_spent + amount_to_spend;
    assert_lt(new_total_spent, re_mint_limit);//, "burn account went over the re_mint_limit limit");
    assert(lower_then_or_equal(new_total_spent, total_burned), "spend exceeds total received");

    //
    let current_account_nonce: Field = prev_account_nonce + 1;
    let new_total_spent_leaf: Field = hash_total_spent_leaf(new_total_spent, current_account_nonce,blinded_address_data_hash, viewing_key);
    assert(new_total_spent_leaf == total_spent_leaf, "account note hash mismatch");

}