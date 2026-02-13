use dep::poseidon::poseidon2::Poseidon2;
//use dep::poseidon::{poseidon};

//use dep::keccak256::keccak256;
use dep::std::field::{bytes32_to_field, bn254::{
    assert_lt, 
    gt
}};
use binary_merkle_root::binary_merkle_root;

// domain separators
global PRIVATE_ADDRESS_TYPE: Field = 0x5a4b574f524d484f4c45; // UTF8("ZKWORMHOLE").toHex() [...new TextEncoder().encode("ZKWORMHOLE")].map(b=>b.toString(16)).join('')
global TOTAL_BURNED_DOMAIN: Field = 0x544f54414c5f4255524e4544; // UTF8("TOTAL_BURNED").toHex()
global TOTAL_SPENT_DOMAIN: Field = 0x544f54414c5f5350454e44; // UTF8("TOTAL_SPEND").toHex()
// @TODO find out what number would be secure enough!
// const POW_LEADING_ZEROS = 4n;
// const POW_DIFFICULTY    = 16n ** (64n - POW_LEADING_ZEROS) - 1n;
global POW_DIFFICULTY: Field =  0x0000ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;//0x000fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff // find a nonce that result in a hash that is hash < POW_DIFFICULTY

// ---------- why max tree depth 42 --------------------
// const erc20Tps = 35_000;
// const zkwormholeTps = erc20Tps / 10;
// const bulkMerkleInserts = 1; // becomes relevant once large reMints emitting multiple commitments are more gas efficient then simple burns. 
// const insertsPerYear = bulkMerkleInserts * zkwormholeTps * 60*60*24*365;
// const treeDepth = 42;
// (2**treeDepth) / insertsPerYear

// depth 42 allows for 40 years on a 35_000 tps chain (megaEth recent stress test) if every tx is a burn tx
// after that, any tokens burned will be actually be burned for real and you will never get them back!
// any tokens before that are fine. That leaf will always exist and the contract always stores that root.
// you can burn tokens before the tree is at a depth above 42, and reMint them a 100 years later those will always be there.
// the ui can warn you, but contract cant prevent it because the contract can't know if your address is a burn address or a normal address!
// ----------------------------------------------------------
global MAX_TREE_DEPTH: u32 = 42; // TODO make this configurable outside lib

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


// @notice chain_id is not used in this repo but can be used to make this cross-chain like warptoad
// viewing_key is there so it is committed in the burn address, 
// to prevent spenders from using a different key and pretend they never spent before when ever the create the nullifier at account_nonce=0
fn hash_blinded_burn_address_data(spending_pub_key_x:Field, chain_id:Field, viewing_key:Field) -> Field {
    Poseidon2::hash([spending_pub_key_x, viewing_key, chain_id], 3)
}

// pow_nonce acts both as a PoW to make finding a hash collision between EOA and BurnAddress harder
fn hash_burn_address(blinded_address_data_hash: Field, pow_nonce: Field ) -> Field {
    let address_hash: Field = Poseidon2::hash([blinded_address_data_hash, pow_nonce, PRIVATE_ADDRESS_TYPE], 3);
    let pow_hash: Field = Poseidon2::hash([pow_nonce, address_hash], 2); 
    assert_lt(pow_hash, POW_DIFFICULTY); //"pow failed: pow_nonce results in hash that is not < POW_DIFFICULTY"

    // // replace last 12 bytes with zero since a eth address is only 20 bytes (noir doesn't support a nicer method hence whacky for loop)
    let bytes: [u8; 32] = address_hash.to_be_bytes();
    let mut eth_address: Field = 0;
    for i in 12..32 {
        eth_address = eth_address * 256 + bytes[i] as Field;
    }
    eth_address


    // this way of doing it makes the ram requirement super large? idk there was something that made it super hard to go beyond 4 burnaddress and this might be it?
    // replace last 12 bytes with zero since address is only 20 bytes (noir doesn't support a nicer method hence whacky for loop)
    // let mut address_bytes: [u8;32] = address_hash.to_be_bytes();
    // for index in 0..12 {
    //     address_bytes[index] = 0;
    // }
    
    // let eth_address: Field = bytes32_to_field(address_bytes);
    // eth_address
}

fn hash_total_burned_leaf(private_address: Field, total_burned: Field) -> Field {
    Poseidon2::hash(
        [private_address, total_burned, TOTAL_BURNED_DOMAIN],
        3,
    )
}

/*
total_spent: total_spend for that specific burn address
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
    prev_account_note_merkle_data: MerkleData,
    total_burned_merkle_data: MerkleData,
}

pub fn spendFromBurnAddresses(
    //public
    root: Field, 
    chain_id: Field,
    total_amount_to_spent: Field, 
    burn_data_public: [BurnDataPublic],
    //private
    burn_data_private: [BurnDataPrivate],
    spending_pub_key_x: Field,    
    amount_burn_addresses: u32
) {
    let mut amount_verified: Field = 0;
    for i in 0..burn_data_private.len() {
        if( i < amount_burn_addresses) {
            spendFromBurnAddress(
                //public
                root,
                chain_id,
                burn_data_public[i].account_note_hash,
                burn_data_public[i].account_note_nullifier,

                //private
                spending_pub_key_x,
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

pub fn spendFromBurnAddress(
    // public
    root: Field,
    chain_id: Field,
    account_note_hash: Field,
    account_note_nullifier: Field,

    // private, keys
    spending_pub_key_x: Field,
    viewing_key: Field,
    pow_nonce: Field,

    // private balances
    amount_to_spend: Field,
    total_burned: Field,
    prev_total_spent: Field,

    // private inclusion proof
    prev_account_nonce: Field,
    prev_account_note_merkle_data: MerkleData,
    total_burned_merkle_data: MerkleData
) {
  
    let blinded_address_data_hash: Field = hash_blinded_burn_address_data(spending_pub_key_x, chain_id, viewing_key );
    let private_address: Field = hash_burn_address(blinded_address_data_hash, pow_nonce);

    // verify how much is "burned"
    let total_burned_leaf: Field = hash_total_burned_leaf(private_address, total_burned);
    let root_total_burned: Field = merkle_hash_root(total_burned_leaf, total_burned_merkle_data);
    assert(root_total_burned == root, "total_burned merkle proof invalid");

    if prev_account_nonce != 0 {
        // verify how much was spent in total before this tx: verify prev_total_spent
        let prev_account_note_hash: Field = hash_total_spent_leaf(prev_total_spent, prev_account_nonce,blinded_address_data_hash, viewing_key);
        let computed_prev_root: Field = merkle_hash_root(prev_account_note_hash, prev_account_note_merkle_data);
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
    let new_total_spent: Field = prev_total_spent + amount_to_spend;
    assert(lower_then_or_equal(new_total_spent, total_burned), "spend exceeds total received");

    //
    let current_account_nonce: Field = prev_account_nonce + 1;
    let computed_account_note_hash: Field = hash_total_spent_leaf(new_total_spent, current_account_nonce,blinded_address_data_hash, viewing_key);
    assert(computed_account_note_hash == account_note_hash, "account note hash mismatch");

}