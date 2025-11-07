import { PrivateTransferVerifierContractName } from "../src/constants.js"
import { lineReplacer } from "./replaceLine.js"

function getLine(name:string) {
    return `contract ${name} is BaseZKHonkVerifier(N, LOG_N, VK_HASH, NUMBER_OF_PUBLIC_INPUTS) {`
}

const file = "contracts/PrivateTransferVerifier.sol"
const originalName = "HonkVerifier"
const newName = PrivateTransferVerifierContractName

const lineReplacements = [
    {
        "original"      :getLine(originalName),
        "replacement"   :getLine(newName)
    }
]
await lineReplacer(file, lineReplacements)