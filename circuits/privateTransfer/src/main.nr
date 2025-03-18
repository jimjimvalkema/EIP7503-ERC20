use dep::std::field::bytes32_to_field;
use dep::std::hash::poseidon;

fn get_private_address(secret: Field) -> Field {
    let hash:[u8; 32] = poseidon::bn254::hash_1([secret]).to_be_bytes(); //.as_array();
    let mut private_address:[u8;32] = [0; 32];

    // TODO do this with math instead of byte arrays
    // replace last 12 bytes with zero since address is only 20 bytes (noir doesnt support a nicer method hence whacky for loop)
    for index in 0..20 {
        private_address[index+12] = hash[index];
    }
    bytes32_to_field(private_address)
}

// nonce makes sure the hash is never the same even when the amount is different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
fn hash_nullifier_value(amount: Field, nonce: Field, secret: Field) -> Field {
    poseidon::bn254::hash_3([amount, nonce, secret])
}

// nonce makes sure the hash is never the same even when the amount is different
// secret is so others cant try and find the pre-image (since this hash is posted onchain)
fn hash_nullifier_key(nonce: Field, secret: Field) -> Field {
    poseidon::bn254::hash_2([nonce, secret])
}

fn lower_then_or_equal(a: Field, b: Field) -> bool {
    !std::field::bn254::gt(a, b)
}

//TODO remane nullifierId -> nullifierKey and nullifier -> nullifierValue
fn main(
    //----- public inputs
    recipient_address: pub Field,// the address to re-mint to
    withdraw_amount: pub Field,
    nullifier_value: pub Field,
    nullifier_key: pub Field,
    root: pub Field,
    //-----very privacy sensitive data -----
    secret: Field,//burnaddress is derived from secret // TODO instead of using a secrets use public cryptography shit so hardware wallets dont have to create a whole ass proof. Also makes complexity lower for hot wallets to ensure safety and better compatability with metamasksnap.
    incoming_balance: Field, // should be Field
    nonce: Field, // nonce to create a nulliefier from to track encrypted spend_amounts
    prev_nullifier_key: Field, // just here for the merkle proof of prev_nullifier, since prev_nullifier already contains all info
    prev_spend_amount: Field,
) {
    // to prevent the proof being stolen from the mempool and used for a differen withdraw address
    // TODO check if you realy need to do this? Tornadocash something similair tho.
    assert(recipient_address != 0x0);

    //------------ merkle proof of mapping(private_address -> incoming_balance) ------------
    // private_address = our secret commitment
    // burn addres should be a field
    let private_address:Field = get_private_address(secret);

    // TODO merkle proof burn address
    // "address" string is there so both the address and nullifiers can be in the same tree without them getting swapped around by an attacker
    let node_burn_addr = 0; // hash(private_address, incoming_balance, "address")
    let root_burn_addr = 0;//TODO

    assert(root_burn_addr == root, "given root doesnt match computed root_burn_addr from the private_address merkle proof");

    //--------prev nullifier------------
    if (nonce != 0) {
        // verify that the nullifier exist onchain with a merkle proof
        // cant do this outside the circuit since that links prev_nullifier_key with the nullifier_key
        let prev_nullifier_value: Field = hash_nullifier_value(prev_spend_amount, nonce - 1, secret);

        // TODO merkle proof prev_nullifier_value
        let node_prev_nullifier = 0; // hash(prev_nullifier_key,prev_nullifier_value, "nullifier")
        let root_prev_nullifier = 0; //TODO hash it (proof,node)

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
    let computed_nullifier_value: Field = hash_nullifier_value(new_spend_amount, nonce, secret);
    assert(
        computed_nullifier_value == nullifier_value, "public input: nullifier_value, doesnt match the one computed in the circuit"
    );

    // ----- nullifier_key -------------
    let computed_nullifier_key = hash_nullifier_key(nonce, secret);
    assert(computed_nullifier_key == nullifier_key, "computed nullifier doesnt match provided nullifier");
}

#[test]
fn test_hashing() {
    let nonce = 0;
    let secret = 123;
    let address = get_private_address(secret);
    let nullifier = hash_nullifier_key(nonce, secret);
    println(address);
    println(nullifier);
}

#[test]
fn test_main() {
    //----- public inputs
    let recipient_address: Field = 0x93211e420c8F552a0e4836f84892a0D4eb5D6D54;
    let withdraw_amount:  Field = 0x8ac7230489e80000;
    let nullifier_value: Field = 0x212456bab521c4afa65cca2751d74f7cbac9ba747d7bc3c21be994b886a7bfe1;
    let nullifier_key: Field = 0x0a2fdf0860adb5ea719794ecf7ec81cc57e56f1846e1508a7fa6448d36cd9624;
    let root: Field = 0;//0x1acea27e9cfb8fd7576d57d039f4c77e0d8edeb1d056bcc5213b7a65842cd900;
    
    //-----private inputs -----
    let secret: Field  = 0x1cf2c2021c2e15a1c61547a32a6295078aacf089edb3cc66fd992f627f30f824;
    let incoming_balance: Field  = 420000000000000000000;
    let nonce: Field = 3;
    let prev_nullifier_key: Field = 0x1546f8d229c5a0943586cd5261ab4adbf995e849976a689a6055a32d4fae8337;
    let prev_spend_amount: Field = 30000000000000000000;

    main(
        //----- public inputs
        recipient_address,
        withdraw_amount,
        nullifier_value,
        nullifier_key,
        root,
        //-----private inputs -----
        secret,
        incoming_balance,
        nonce,
        prev_nullifier_key,
        prev_spend_amount,
    );
}


