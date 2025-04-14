use dep::std::field::bytes32_to_field;
use dep::std::hash::poseidon;

global ADDRESS_TYPE: Field = poseidon::bn254::hash_1([0x7a6b776f726d686f6c65]); // UTF8("zkwormhole").toHex()

fn get_private_address(viewing_key: Field, chain_id: Field, address_type: Field) -> Field {
    let hash:[u8; 32] = poseidon::bn254::hash_3([viewing_key,chain_id,address_type ]).to_be_bytes(); //.as_array();
    let mut private_address:[u8;32] = [0; 32];

    // TODO do this with math instead of byte arrays
    // replace last 12 bytes with zero since address is only 20 bytes (noir doesnt support a nicer method hence whacky for loop)
    for index in 0..20 {
        private_address[index+12] = hash[index];
    }
    bytes32_to_field(private_address)
}

// account_nonce makes sure the hash is never the same even when the amount is different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
fn hash_nullifier_value(amount: Field, account_nonce: Field, secret: Field) -> Field {
    poseidon::bn254::hash_3([amount, account_nonce, secret])
}

// account_nonce makes sure the hash is never the same even when the amount is different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
fn hash_nullifier_key(account_nonce: Field, secret: Field) -> Field {
    poseidon::bn254::hash_2([account_nonce, secret])
}

fn lower_then_or_equal(a: Field, b: Field) -> bool {
    !std::field::bn254::gt(a, b)
}

struct Signature_data {
    public_key_x: [u8;32], 
    public_key_y: [u8;32], 
    signature: [u8;64], 
}

fn main(
    //----- public inputs
    chain_id: pub Field,
    recipient_address: pub Field,      
    withdraw_amount: pub Field,
    relayer_address: pub Field,         // TODO if relayer_address = 0x0000... <- we don't check in contract and so can be anyone, who dares to fight the mev bots (likely block builder)
    token_price_eth: pub Field,         // Not the true price of token/eth. But whatever the user decides to pay the relayer relative to block.basefee * gas_cost. So the user should probably set this price a bit higher then the real price to compensate for priorityFee, relayerInfraCost and other hidden cost 
    max_fee: pub Field,                 // NOTE to self: the user pays: relayer_fee = gas_cost * block.basefee * token_price_eth. But relayers pays gas_cost * (block.basefee, priorityFee). gas_cost can change per hard fork and priorityFee at network congestion. User should consider this by lowering or raising the token_price_eth 

    nullifier_value: pub Field,         // tracks how much is spend after this transfer hash(prev_spend_amount+withdraw_amount, account_nonce, viewing_key)
    nullifier_key: pub Field,           // a deterministic identifier so we can lookup nullifier_value.  hash(account_nonce, viewing_key)
    root: pub Field,                    // root of merkle tree we use to privately proof incoming_balance, prev_nullifier are on the chain.
    //-----very privacy sensitive data -----
    viewing_key: Field,                 // prob just take sig.#r from `sig = ethers.Signature.from( await signer.signMessage(message))`
    signature_data: Signature_data,     // contains hash(account_nonce,withdraw_amount,recipient_address) 

    incoming_balance: Field,            // the "balanceOf" of the private_address
    account_nonce: Field,               // starts at 0, increments by one every private transaction (not a ethereum account nonce, its zkwormhole account!)
    prev_nullifier_key: Field,          // just here for the merkle proof of prev_nullifier, since prev_nullifier already contains all info, we dont need to hash it in circuit
    prev_spend_amount: Field,           // needed to verify incoming_balance-prev_spend_amount > withdraw_amount. and to create nullifier_value=hash(prev_spend_amount+withdraw_amount, account_nonce, viewing_key)
) { 

    // less constraints then assert(lt(a, b)) but i cant attach a error message :(
    std::field::bn254::assert_lt(max_fee ,  withdraw_amount); // "max_fee needs to be lower then the withdraw_amount"

    // to prevent the proof being stolen from the mempool and used for a different withdraw address
    // TODO remove this when we verify the sig since it already contains this
    assert(recipient_address != 0x0);

    //------------ merkle proof of mapping(private_address -> incoming_balance) ------------
    // private_address = our secret commitment
    // private address should be a field
    // @TODO verify a signature here. prob sign hash(account_nonce,withdraw_amount,recipient_address)
    let message_hash: [u8;32] = [0;32]; // hash(account_nonce,withdraw_amount,recipient_address)
    assert(false, "TODO message_hash" );
    let valid_signature = std::ecdsa_secp256k1::verify_signature(signature_data.public_key_x, signature_data.public_key_y, signature_data.signature, message_hash);
    assert(valid_signature);

    let private_address:Field = get_private_address(viewing_key,chain_id,ADDRESS_TYPE);

    // TODO merkle proof private address
    // "address" string is there so both the address and nullifiers can be in the same tree without them getting swapped around by an attacker
    let node_private_addr = 0; // hash(private_address, incoming_balance, "address")
    let root_private_addr = 0; //TODO
    assert(false, "TODO merkle proof private address" );

    assert(root_private_addr == root, "given root doesn't match computed root_private_addr from the private_address merkle proof");

    //--------prev nullifier------------
    if (account_nonce != 0) {
        // verify that the nullifier exist onchain with a merkle proof
        // cant do this outside the circuit since that links prev_nullifier_key with the nullifier_key
        let prev_nullifier_value: Field = hash_nullifier_value(prev_spend_amount, account_nonce - 1, viewing_key);

        // TODO merkle proof prev_nullifier_value
        assert(false, "TODO merkle proof prev_nullifier_value" );
        let node_prev_nullifier = 0; // hash(prev_nullifier_key,prev_nullifier_value, "nullifier")
        let root_prev_nullifier = 0; //TODO hash it calculate_root(proof,node)

        assert(root_prev_nullifier == root, "given root doesnt match computed root_prev_nullifier from the prev_nullifier merkle proof");

    } else {
        // we dont need to check prev_nullifier_key since it doenst exist and we can keep prev_spend_amount at 0
        // TODO make the nullifier proof a recursive proof so the first tx is ~2x faster to proof
    }

    // ----- Current Nullifier-------------
    // @WARNING TODO watch out for overflows (solution?: make sure max supply of coin is < FIELD_LIMIT inside contract)
    let new_spend_amount: Field = withdraw_amount + prev_spend_amount;
    // new_spend_amount <= incoming_balance
    assert(lower_then_or_equal(new_spend_amount, incoming_balance), "withdraw_amount too large, new_spend_amount is larger than incoming_balance");
    let computed_nullifier_value: Field = hash_nullifier_value(new_spend_amount, account_nonce, viewing_key);
    assert(
        computed_nullifier_value == nullifier_value, "public input: nullifier_value, doesnt match the one computed in the circuit"
    );

    // ----- nullifier_key -------------
    let computed_nullifier_key = hash_nullifier_key(account_nonce, viewing_key);
    assert(computed_nullifier_key == nullifier_key, "computed nullifier doesnt match provided nullifier");
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
//     let withdraw_amount:  Field = 0x8ac7230489e80000;
//     let nullifier_value: Field = 0x212456bab521c4afa65cca2751d74f7cbac9ba747d7bc3c21be994b886a7bfe1;
//     let nullifier_key: Field = 0x0a2fdf0860adb5ea719794ecf7ec81cc57e56f1846e1508a7fa6448d36cd9624;
//     let root: Field = 0;//0x1acea27e9cfb8fd7576d57d039f4c77e0d8edeb1d056bcc5213b7a65842cd900;
    
//     //-----private inputs -----
//     let secret: Field  = 0x1cf2c2021c2e15a1c61547a32a6295078aacf089edb3cc66fd992f627f30f824;
//     let incoming_balance: Field  = 420000000000000000000;
//     let account_nonce: Field = 3;
//     let prev_nullifier_key: Field = 0x1546f8d229c5a0943586cd5261ab4adbf995e849976a689a6055a32d4fae8337;
//     let prev_spend_amount: Field = 30000000000000000000;

//     main(
//         //----- public inputs
//         recipient_address,
//         withdraw_amount,
//         nullifier_value,
//         nullifier_key,
//         root,
//         //-----private inputs -----
//         secret,
//         incoming_balance,
//         account_nonce,
//         prev_nullifier_key,
//         prev_spend_amount,
//     );
// }
