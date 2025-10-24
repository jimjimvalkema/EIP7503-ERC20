import { expect } from "chai"
import { run } from "hardhat"
import { poseidon2 } from "poseidon-lite"
import {} from "../"

describe("Token", () => {
    const SNARK_SCALAR_FIELD = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617")
    let binaryIMT: Tokee


    beforeEach(async () => {
        const { library, contract } = await run("deploy:imt-test", { library: "BinaryIMT", logs: false })

        binaryIMT = library
        binaryIMTTest = contract
        jsBinaryIMT = new JSBinaryIMT(poseidon2, 6, 0, 2)
    })
    describe("transfer", () => {
    })
})