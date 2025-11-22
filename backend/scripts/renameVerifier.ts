import { ArgumentParser } from "argparse";
import { lineReplacer } from "./replaceLine.js"

const originalName = "HonkVerifier"


function getLine(name: string) {
    return `contract ${name} is BaseZKHonkVerifier(N, LOG_N, VK_HASH, NUMBER_OF_PUBLIC_INPUTS) {`
}

const parser = new ArgumentParser({
    description: 'quick lil script to replace 1 line',
    usage: `yarn tsx scripts_dev_op/replaceLine.ts --file contracts/evm/WithdrawVerifier.sol --newName privateTransferVerifier1n`
});
parser.add_argument('-f', '--file', { help: 'file to read', required: true, type: 'str' });
parser.add_argument('-r', '--newName', { help: 'specify what new name the verifier needs', required: true, type: 'str' });
const args = parser.parse_args()

const file = args.file
const newName = args.newName


const lineReplacements = [
    {
        "original": getLine(originalName),
        "replacement": getLine(newName)
    }
]
await lineReplacer(file, lineReplacements)