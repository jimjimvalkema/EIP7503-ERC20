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

fn main(
    //----- public inputs
    amount: pub Field,
    signature_hash: pub [u8;32],
    // recipient_address: pub Field,
    // fee_data: pub FeeData,
    account_note_hash: pub Field,       // tracks how much is spend after this transfer hash(prev_total_spent+amount, prev_account_nonce, viewing_key)
    account_note_nullifier: pub Field,  // nullifies the previous account_note.  hash(prev_account_nonce, viewing_key)
    root: pub Field,                    // root of merkle tree we use to privately proof total_received, prev_nullifier are on the chain.
    //-----very privacy sensitive data -----
    signature_data: SignatureData,      // contains hash(prev_account_nonce,amount,recipient_address)
    shared_secret: Field,               // to limit the collision attacks between EOAs and private_addresses, 
    total_received: Field,              // the "balanceOf" of the private_address
    prev_total_spent: Field,            // needed to verify total_received-prev_total_spent > amount. and to create nullifier_value=hash(prev_total_spent+amount, prev_account_nonce, viewing_key)
    viewing_key: Field,                 // used as randomness to blind commitments. Prob just take sig.#r from `sig = ethers.Signature.from( await signer.signMessage(message))`
    prev_account_nonce: Field,               // starts at 0, increments by one every private transaction (not a ethereum account nonce, its zkwormhole account!)
    prev_account_note_merkle: MerkleData,
    total_received_merkle: MerkleData,
) {
    // less constraints then assert(lt(a, b)) but i cant attach a error message :(
    // prevents promising the relayer more fees then can be spend
    //assert_lt(max_fee, amount); // "max_fee needs to be lower then the amount"

    //------------ merkle proof of total_received and private_address ------------

    // @TODO do we need more inputs to commit to in the signature?
    // we commit to this in the signature so if a users machine is compromised, at least the attacker cant mess with these values, provided it's signed by a hardware wallet
    // TODO we prob need to use keccak here, or maybe we can blind sign in viem
    // let poseidon_message_hash: [u8; 32] = hash_signature_inputs(recipient_address,amount,fee_data);
    // let keccak_message_pre_img: [u8; 60] = ETH_SIGN_PREFIX.concat( poseidon_message_hash);
    // let keccak_message_hash: [u8; 32] = keccak256(keccak_message_pre_img, keccak_message_pre_img.len());
    let valid_signature: bool = std::ecdsa_secp256k1::verify_signature(
        signature_data.public_key_x,
        signature_data.public_key_y,
        signature_data.signature,
        signature_hash,
    );

    assert(valid_signature, "invalid signature");
    // slice off the first byte so it fits in the field
    let mut small_pub_key_x: [u8; 32] = signature_data.public_key_x;
    small_pub_key_x[0] = 0;
    let pub_key_x_field: Field = Field::from_be_bytes(small_pub_key_x);
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

#[test]
fn verify_sig() {
    let signature_data:SignatureData = SignatureData {
        public_key_x: [244,28,215,192,211,91,249,255,187,119,71,137,203,63,135,230,202,61,19,185,192,191,226,1,143,87,250,143,0,5,152,234],
        public_key_y: [44,245,100,66,161,117,80,1,185,140,4,112,174,182,209,93,233,149,135,167,249,202,162,217,82,145,96,36,87,96,205,129],
        signature: [14,128,49,202,4,250,111,112,29,6,97,171,208,190,254,167,44,251,221,247,135,155,141,136,119,129,69,35,219,88,71,177,82,85,103,13,229,15,221,25,122,149,21,17,81,157,29,41,50,66,167,84,146,131,99,55,88,96,21,175,143,96,27,9]
    };
    let message_hash:[u8;32] = 0x0000000000000000000000000000000000000000000000000000000000420690.to_be_bytes();

    let valid_signature: bool = std::ecdsa_secp256k1::verify_signature(
        signature_data.public_key_x,
        signature_data.public_key_y,
        signature_data.signature,
        message_hash,
    );

    assert(valid_signature, "invalid signature");
}
