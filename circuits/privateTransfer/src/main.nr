use dep::poseidon::poseidon2::Poseidon2;
use dep::std::field::bytes32_to_field;
use binary_merkle_root::binary_merkle_root;

// domain separators
global PRIVATE_ADDRESS_TYPE: Field = Poseidon2::hash([0x7a6b776f726d686f6c65], 1); // UTF8("zkwormhole").toHex()
global RECEIVED_TOTAL_DOMAIN: Field = 0x52454345495645445F544F54414C; // UTF8("RECEIVED_TOTAL").toHex()
global SPENT_TOTAL_DOMAIN: Field = 0x5350454E545F544F54414C; // UTF8("SPENT_TOTAL").toHex()
// @TODO find out what number would be secure enough!
global POW_DIFFICULTY: Field = 0xffff; // find a nonce that result in a hash that is hash > POW_DIFFICULTY

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

// pow_nonce should be deterministically derived from the viewing_key, ex hash(viewing_key) N times until a valid PoW
// and viewing_key should be deterministically derived from the seed-phrase / priv_key, ex: deterministicSign(my_priv_key, "some standard message that notifies the user the viewing_key is created, etc")
// ethereum signatures are already deterministic, there is mailability, but we don't care about that in this case
// we want the preserve the "i only need my seed-phrase to recover" UX, which is very important!!!!
fn get_private_address(pub_key: Field, pow_nonce: Field ) -> Field {
    // EIP7503 reintroduces an attack vector with address collisions because addresses are only 20 bytes. This time its with EOAs and ZKwormhole addresses. 
    // This allows the attacker to find a address that is both a EOA and a zkwormhole address. Which allows the hacker to mint infinite tokens.
    // The cost for this attack is estimated to be 10 billion dollars in 2021.
    // more info here: https://hackmd.io/Vzhp5YJyTT-LhWm_s0JQpA and here: https://eips.ethereum.org/EIPS/eip-3607

    // Here we add pow_nonce to the address hashing and the PoW verification to force the attacker to do a PoW challenge on each attempt
    // pow_nonce need to be added to address_hash input other wise the attacker can find colliding address and do the PoW challenge afterwards
    // the pow_hash has the address_hash as input to prevent the attacker from reusing pow_nonces
    let address_hash: Field = Poseidon2::hash([pub_key,pow_nonce, PRIVATE_ADDRESS_TYPE], 3);
    let pow_hash: Field = Poseidon2::hash([pow_nonce, address_hash], 2); 
    std::field::bn254::assert_gt(pow_hash, POW_DIFFICULTY); //"pow failed: pow_nonce results in hash that is not > POW_DIFFICULTY"
    
    // replace last 12 bytes with zero since address is only 20 bytes (noir doesn't support a nicer method hence whacky for loop)
    let mut address_bytes: [u8;32] = address_hash.to_be_bytes();
    for index in 20..32 {
        address_bytes[index] = 0;
    }
    bytes32_to_field(address_bytes)
}

fn hash_received_total_leaf(private_address: Field, received_total: Field) -> Field {
    Poseidon2::hash(
        [private_address, received_total, RECEIVED_TOTAL_DOMAIN],
        3,
    )
}

// account_nonce makes sure the hash is never the same even when the spent_total is not different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
fn hash_account_note(spent_total: Field, account_nonce: Field, viewing_key: Field) -> Field {
    Poseidon2::hash([spent_total, account_nonce, viewing_key, SPENT_TOTAL_DOMAIN], 4)
}

// account_nonce makes sure the hash is never the same even when the spent_total is not different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
fn hash_nullifier(account_nonce: Field, viewing_key: Field) -> Field {
    Poseidon2::hash([account_nonce, viewing_key], 2)
}

fn lower_then_or_equal(a: Field, b: Field) -> bool {
    !std::field::bn254::gt(a, b)
}

struct SignatureData {
    public_key_x: [u8; 32],
    public_key_y: [u8; 32],
    signature: [u8; 64],
}

struct FeeData {
    // relayerAddress = 0 <= self relay, relayerAddress = 1 <= msg.sender will relay, all other will send it to that address like expected
    relayer_address: Field,
    // there is no way for the contract to know what priority fee is set so the spender just has to set it for the relayer (who ofc can choose a different number)
    priority_fee: Field,
    // gas usage can change in network upgrades or when the merkle tree grows deeper
    // price of eth in fee_token * gas_used
    conversion_rate: Field,
    // in the contract the fee is calculated feeAmountInFeeToken = (pubInput.priority_fee + block.baseFee) * pubInput.conversion_rate
    // and should feeAmountInFeeToken < max_fee.
    // conversionRate = gasUsage*tokenPriceInWei*relayerBonusFactor. ex gasUsage=45000,tokenPriceInEth=0.048961448,relayerBonusFactor=10%
    // conversionRate = 45000 * 48955645000000000 * 1.1
    max_fee: Field,
    // fee_token is not that interesting rn because it really can only be the token it self,
    // but in the future where it is integrated as a deposit method of a rail-gun like system it can be use full.
    fee_token: Field,
}

struct MerkleData {
    depth: u32,
    indices: [u1; MAX_TREE_DEPTH],
    siblings: [Field; MAX_TREE_DEPTH],
}

fn main(
    //----- public inputs
    amount: pub Field,
    recipient_address: pub Field,
    fee_data: pub FeeData,
    account_note_hash: pub Field,       // tracks how much is spend after this transfer hash(prev_spent_total+amount, account_nonce, viewing_key)
    account_note_nullifier: pub Field,  // nullifies the previous account_note.  hash(account_nonce, viewing_key)
    root: pub Field,                    // root of merkle tree we use to privately proof received_total, prev_nullifier are on the chain.
    //-----very privacy sensitive data -----
    signature_data: SignatureData,      // contains hash(account_nonce,amount,recipient_address)
    pow_nonce: Field,                    // to limit the collision attacks between EOAs and private_addresses, 
    received_total: Field,              // the "balanceOf" of the private_address
    prev_spent_total: Field,            // needed to verify received_total-prev_spent_total > amount. and to create nullifier_value=hash(prev_spent_total+amount, account_nonce, viewing_key)
    viewing_key: Field,                 // used as randomness to blind commitments. Prob just take sig.#r from `sig = ethers.Signature.from( await signer.signMessage(message))`
    account_nonce: Field,               // starts at 0, increments by one every private transaction (not a ethereum account nonce, its zkwormhole account!)
    prev_account_note_merkle: MerkleData,
    received_total_merkle: MerkleData,
) {
    // less constraints then assert(lt(a, b)) but i cant attach a error message :(
    // prevents promising the relayer more fees then can be spend
    std::field::bn254::assert_lt(fee_data.max_fee, amount); // "max_fee needs to be lower then the amount"

    //------------ merkle proof of received_total and private_address ------------

    // @TODO do we need more inputs to commit to in the signature?
    // we commit to this in the signature so if a users machine is compromised, at least the attacker cant mess with these values, provided it's signed by a hardware wallet
    let message_hash: [u8; 32] = Poseidon2::hash(
        [
            recipient_address,
            amount,
            fee_data.relayer_address,
            fee_data.priority_fee,
            fee_data.conversion_rate,
            fee_data.max_fee,
        ],
        5,
    ).to_be_bytes();

    let valid_signature: bool = std::ecdsa_secp256k1::verify_signature(
        signature_data.public_key_x,
        signature_data.public_key_y,
        signature_data.signature,
        message_hash,
    );

    assert(valid_signature, "invalid signature");
    // public_key_x is 32 bytes so can go over the field limit but from_be_bytes will just wrap around which is fine in this case
    let pub_key_x_field: Field = Field::from_be_bytes(signature_data.public_key_x);
    let private_address: Field = get_private_address(pub_key_x_field, pow_nonce);

    let received_total_leaf = hash_received_total_leaf(private_address, received_total);

    // calculate the root from the merkle proof and assert it is the same as `root`
    let root_received_total: Field = compute_root(received_total_leaf,received_total_merkle);
    assert(
        root_received_total == root,
        "given root doesn't match computed root_private_addr from the private_address merkle proof",
    );

    //--------prev_spent_total------------
    if (account_nonce != 0) {
        // verify that the prev_spent_total exist onchain with a merkle proof
        let prev_account_note_hash: Field = hash_account_note(prev_spent_total, account_nonce, viewing_key);
        let computed_prev_account_note_root: Field = compute_root(prev_account_note_hash,prev_account_note_merkle); 
        assert(
            computed_prev_account_note_root == root,
            "given root doesn't match computed root_prev_account_note_hash from the prev_nullifier merkle proof",
        );
    } else {
        // in this case it's the first spend so there is no note_hash to prove inclusion of
        // redundant check but can prevent user burning funds on their first spend
        assert(prev_spent_total == 0, "account_nonce is zero but prev_spent_total isn't")
    }
    // ----- nullify the prev note -------------
    // note: at account_nonce=0 we nullify even though no pre prev_account_note exists, 
    // in this case we nullify the "first spend event" so the first spend cant happen again
    let computed_nullifier: Field = hash_nullifier(account_nonce, viewing_key);
    assert(computed_nullifier == account_note_nullifier, "computed_nullifier doesn't match the account_note_nullifier");

    // ----- create new account_note-------------
    // @WARNING TODO watch out for overflows (solution?: make sure max supply of coin is < FIELD_LIMIT inside contract)
    let new_spent_amount: Field = amount + prev_spent_total;
    assert(
        lower_then_or_equal(new_spent_amount, received_total),
        "amount too large, new_spend_amount is larger than received_total",
    );
    let computed_account_note_hash: Field = hash_account_note(new_spent_amount, account_nonce, viewing_key);
    assert(
        computed_account_note_hash == account_note_hash,
        "public input: nullifier_value, doesn't match the one computed in the circuit",
    );
}

// #[test]
// fn test_hashing() {
//     let account_nonce = 0;
//     let secret = 123;
//     let address = get_private_address(secret);
//     let nullifier = hash_nullifier_key(account_nonce, secret);
//     println(address);
//     println(nullifier);
// }

// #[test]
// fn test_main() {
//     //----- public inputs
//     let recipient_address: Field = 0x93211e420c8F552a0e4836f84892a0D4eb5D6D54;
//     let amount:  Field = 0x8ac7230489e80000;
//     let nullifier_value: Field = 0x212456bab521c4afa65cca2751d74f7cbac9ba747d7bc3c21be994b886a7bfe1;
//     let nullifier_key: Field = 0x0a2fdf0860adb5ea719794ecf7ec81cc57e56f1846e1508a7fa6448d36cd9624;
//     let root: Field = 0;//0x1acea27e9cfb8fd7576d57d039f4c77e0d8edeb1d056bcc5213b7a65842cd900;

//     //-----private inputs -----
//     let secret: Field  = 0x1cf2c2021c2e15a1c61547a32a6295078aacf089edb3cc66fd992f627f30f824;
//     let received_total: Field  = 420000000000000000000;
//     let account_nonce: Field = 3;
//     let prev_nullifier_key: Field = 0x1546f8d229c5a0943586cd5261ab4adbf995e849976a689a6055a32d4fae8337;
//     let prev_spent_total: Field = 30000000000000000000;

//     main(
//         //----- public inputs
//         recipient_address,
//         amount,
//         nullifier_value,
//         nullifier_key,
//         root,
//         //-----private inputs -----
//         secret,
//         received_total,
//         account_nonce,
//         prev_nullifier_key,
//         prev_spent_total,
//     );
// }
