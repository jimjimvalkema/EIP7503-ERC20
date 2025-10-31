import { Hex, toBytes } from "viem";

export function noir_verify_sig({pubKeyXHex,pubKeyYHex,rawSigHex,hash}:{pubKeyXHex:Hex,pubKeyYHex:Hex,rawSigHex:Hex,hash:Hex}) {
    return `
#[test]
fn verify_sig() {
    let signature_data:SignatureData = SignatureData {
        public_key_x: [${[...toBytes(pubKeyXHex)].toString()}],
        public_key_y: [${[...toBytes(pubKeyYHex)].toString()}],
        signature: [${[...toBytes(rawSigHex)].toString()}]
    };
    let message_hash:[u8;32] = ${hash}.to_be_bytes();

    let valid_signature: bool = std::ecdsa_secp256k1::verify_signature(
        signature_data.public_key_x,
        signature_data.public_key_y,
        signature_data.signature,
        message_hash,
    );

    assert(valid_signature, "invalid signature");
}
`
}