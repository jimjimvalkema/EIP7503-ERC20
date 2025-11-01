use dep::poseidon::poseidon2::Poseidon2;
use dep::keccak256::keccak256;
use dep::std::{ field::{bytes32_to_field, bn254::assert_gt}};
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
    assert_gt(POW_DIFFICULTY, pow_hash); //"pow failed: pow_nonce results in hash that is not > POW_DIFFICULTY"
    // let pow_diff: Field = pow_hash/POW_DIFFICULTY;
    // assert(pow_diff == 0, "failed POW");
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

fn hash_signature_inputs(recipient_address: Field, amount: Field, fee_data: FeeData) -> [u8;32] {
    Poseidon2::hash(
        [
            recipient_address,
            amount,
            fee_data.relayer_address,
            fee_data.priority_fee,
            fee_data.conversion_rate,
            fee_data.max_fee,
        ],
        6,
    ).to_be_bytes()
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
    account_note_hash: pub Field,       // tracks how much is spend after this transfer hash(prev_total_spent+amount, prev_account_nonce, viewing_key)
    account_note_nullifier: pub Field,  // nullifies the previous account_note.  hash(prev_account_nonce, viewing_key)
    root: pub Field,                    // root of merkle tree we use to privately proof total_received, prev_nullifier are on the chain.
    //-----very privacy sensitive data -----
    signature_data: SignatureData,      // contains hash(prev_account_nonce,amount,recipient_address)
    pow_nonce: Field,                    // to limit the collision attacks between EOAs and private_addresses, 
    total_received: Field,              // the "balanceOf" of the private_address
    prev_total_spent: Field,            // needed to verify total_received-prev_total_spent > amount. and to create nullifier_value=hash(prev_total_spent+amount, prev_account_nonce, viewing_key)
    viewing_key: Field,                 // used as randomness to blind commitments. Prob just take sig.#r from `sig = ethers.Signature.from( await signer.signMessage(message))`
    prev_account_nonce: Field,               // starts at 0, increments by one every private transaction (not a ethereum account nonce, its zkwormhole account!)
    prev_account_note_merkle: MerkleData,
    total_received_merkle: MerkleData,
) {
    // less constraints then assert(lt(a, b)) but i cant attach a error message :(
    // prevents promising the relayer more fees then can be spend
    std::field::bn254::assert_lt(fee_data.max_fee, amount); // "max_fee needs to be lower then the amount"

    //------------ merkle proof of total_received and private_address ------------

    // @TODO do we need more inputs to commit to in the signature?
    // we commit to this in the signature so if a users machine is compromised, at least the attacker cant mess with these values, provided it's signed by a hardware wallet
    // TODO we prob need to use keccak here, or maybe we can blind sign in viem
    let poseidon_message_hash: [u8; 32] = hash_signature_inputs(recipient_address,amount,fee_data);
    let keccak_message_pre_img: [u8; 60] = ETH_SIGN_PREFIX.concat( poseidon_message_hash);
    let keccak_message_hash: [u8; 32] = keccak256(keccak_message_pre_img, keccak_message_pre_img.len());
    let valid_signature: bool = std::ecdsa_secp256k1::verify_signature(
        signature_data.public_key_x,
        signature_data.public_key_y,
        signature_data.signature,
        keccak_message_hash,
    );

    assert(valid_signature, "invalid signature");
    // slice off the first byte so it fits in the field
    let mut small_pub_key_x: [u8; 32] = signature_data.public_key_x;
    small_pub_key_x[0] = 0;
    let pub_key_x_field: Field = Field::from_be_bytes(small_pub_key_x);
    let private_address: Field = get_private_address(pub_key_x_field, pow_nonce);

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

// #[test]
// fn bytes_to_field() {
//     // from_be_bytes wraps around when it goes over the field limit: large_number % FIELD_MODULUS
//     let field_limit: [u8; 32] = [48,100,78,114,225,49,160,41,184,80,69,182,129,129,88,93,40,51,232,72,121,185,112,145,67,225,245,147,240,0,0,0];
//     let field_limit_plus_one: [u8; 32] = [48,100,78,114,225,49,160,41,184,80,69,182,129,129,88,93,40,51,232,72,121,185,112,145,67,225,245,147,240,0,0,1];
//     let field_limit_plus_two: [u8; 32] = [48,100,78,114,225,49,160,41,184,80,69,182,129,129,88,93,40,51,232,72,121,185,112,145,67,225,245,147,240,0,0,2];
//     println("field_limit");
//     println("field_limit");
//     println(Field::from_be_bytes(field_limit));
//     println("field_limit_plus_one");
//     println(Field::from_be_bytes(field_limit_plus_one));
//     println("field_limit_plus_two");
//     println(Field::from_be_bytes(field_limit_plus_two));
// }

#[test]
fn wrap() {
    let (hash_h, hash_l) = std::field::bn254::decompose(0x000eeed5c0ff5b4932f1dc3ffcc9fc2fbc06e49f9d1df500be9087c111aafd40);
    let (pow_diff_h, pow_diff_l) = std::field::bn254::decompose(POW_DIFFICULTY);
    println("pow_diff_l");
    println(pow_diff_l);
    println("hash_h");
    println(pow_diff_h);
    println("pow_diff_h");
    println(hash_l);
    println("hash_h");
    println(hash_h);
    assert_gt(POW_DIFFICULTY, 0x000eeed5c0ff5b4932f1dc3ffcc9fc2fbc06e49f9d1df500be9087c111aafd40);
}

#[test]
fn main_test() {   
    let amount: Field = 69;
    let recipient_address: Field = 0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc;
    let fee_data: FeeData = FeeData {
        relayer_address:  0x0,
        priority_fee: 0,
        conversion_rate: 0,
        max_fee: 0,
        fee_token:  0x0,
    };
    let account_note_hash: Field = 0x1cf3e0a0bcd72bb0493c0152e7d0ac4694d57837ff0325f90fa51cdaf987109f;       
    let account_note_nullifier: Field = 0x17cc264432e41c214370017559210b64fadffb7a1a58dc96ae0a63ddb9a6c107; 
    let root: Field = 0x15bf4f7f86b425ebc180c2766514c2e4248895309e0662d65ce764667fb4e410;                    
    let signature_data: SignatureData = SignatureData {
        public_key_x: [186,87,52,216,247,9,23,25,71,30,127,126,214,185,223,23,13,199,12,198,97,202,5,230,136,96,26,217,132,240,104,176],
        public_key_y: [214,115,81,229,240,96,115,9,36,153,51,106,176,131,158,248,165,33,175,211,52,229,56,7,32,95,162,240,142,236,116,244],
        signature: [166,24,154,103,72,1,100,43,81,197,204,171,19,255,196,81,62,95,34,133,121,96,139,189,97,75,3,43,157,253,49,22,67,113,115,90,169,18,210,199,57,204,91,86,72,81,14,38,100,151,151,165,135,9,183,148,81,28,101,14,248,52,84,133],
    }; 
    let pow_nonce: Field = 0xf712c21959944178a16658fd5c0528bc33ebb19480b1611e1c3b94b3defa441;                  
    let total_received: Field = 1260;              
    let prev_total_spent: Field = 0;            
    let viewing_key: Field = 0x1e8d63b4b35cf2bb6cefc2cb699ca28811b8172de4270de23ad4d1f1a53bc6aa;                 
    let prev_account_nonce: Field = 0;               
    let prev_account_note_merkle: MerkleData = MerkleData {
        depth: 0,
        indices:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        siblings:[0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0]
    };
    let total_received_merkle: MerkleData = MerkleData {
        depth: 2,
        indices:[1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
        siblings:[0x15007c73a650ff7b36dfb19153f3754dafa69b7197fb3b36fff9e1e5d9274fa6,0x29e5b85f9fa19b2a4c30f6dc328b8bd3b6b60f466739c4eb5f39cb3e4937406d,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0,0x0]
    };
    main(
        amount,
        recipient_address,
        fee_data,
        account_note_hash, 
        account_note_nullifier,
        root,
        signature_data,
        pow_nonce,        
        total_received,  
        prev_total_spent,
        viewing_key,   
        prev_account_nonce,
        prev_account_note_merkle,
        total_received_merkle,
    );
}