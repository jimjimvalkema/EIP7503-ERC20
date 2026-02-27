// this sucks i know. It's because of a bug of hardhat verify. It cant handle the names being the same
import { ArgumentParser } from "argparse";
import { lineReplacer } from "./replaceLine.ts"

const originalName = "ZKTranscriptLib"


function getLines(name: string) {
    return [
        `library ${name} {`,
        `        Honk.ZKProof memory p = ${name}.loadProof(proof, $LOG_N);`,
        `            ${name}.generateTranscript(p, publicInputs, $VK_HASH, $NUM_PUBLIC_INPUTS, $LOG_N);`,
    ]
}

const parser = new ArgumentParser({
    description: 'quick lil script to replace 3 lines',
    usage: `yarn tsx scripts/renameZKLib.ts --file contracts/privateTransfer100InVerifier.sol --newName ZKTranscriptLib100In`
});
parser.add_argument('-f', '--file', { help: 'file to read', required: true, type: 'str' });
parser.add_argument('-r', '--newName', { help: 'specify what new name the verifier needs', required: true, type: 'str' });
const args = parser.parse_args()

const file = args.file
const newName = args.newName

const originals = getLines(originalName)
const replacements = getLines(newName)
const lineReplacements = originals.map((v, i) => {
    return {
        "original": originals[i],
        "replacement": replacements[i]
    }
})

await lineReplacer(file, lineReplacements)