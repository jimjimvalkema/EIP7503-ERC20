/**
 * ERC-7730 Field Formatter Engine
 * Formats fields according to display specifications
 */

import type { FieldFormat, FormatType, FormattedField, ERC7730Descriptor, ContainerValues } from './types'
import { resolvePath } from './descriptor'

/**
 * Format a field value according to its format specification
 */
export function formatField(
	value: unknown,
	fieldFormat: FieldFormat,
	descriptor: ERC7730Descriptor,
	container: ContainerValues,
	structuredData: Record<string, unknown>
): string {
	if (!fieldFormat.format) {
		return String(value)
	}

	const format = fieldFormat.format as FormatType
	const params = fieldFormat.params || {}

	try {
		switch (format) {
			case 'raw':
				return formatRaw(value)
			case 'amount':
				return formatAmount(value as string | number)
			case 'tokenAmount':
				return formatTokenAmount(
					value as string | number,
					params,
					descriptor,
					container,
					structuredData
				)
			case 'date':
				return formatDate(value as string | number, params)
			case 'duration':
				return formatDuration(value as number)
			case 'unit':
				return formatUnit(value as number, params)
			case 'enum':
				return formatEnum(value, params, descriptor)
			case 'addressName':
				return formatAddressName(value as string, params)
			case 'tokenTicker':
				return formatTokenTicker(value as string, params, descriptor)
			case 'nftName':
				return formatNftName(value as string | number, params)
			case 'calldata':
				return formatCalldata(value as string, params)
			default:
				return String(value)
		}
	} catch (error) {
		console.error(`Error formatting field with ${format}:`, error)
		return String(value)
	}
}

function formatRaw(value: unknown): string {
	return String(value)
}

function formatAmount(value: string | number): string {
	const num = typeof value === 'string' ? BigInt(value) : BigInt(value)
	// Convert from wei (18 decimals) to ETH
	const eth = Number(num) / 1e18
	return eth.toLocaleString('en-US', { maximumFractionDigits: 6 }) + ' ETH'
}

function formatTokenAmount(
	value: string | number,
	params: Record<string, unknown>,
	descriptor: ERC7730Descriptor,
	container: ContainerValues,
	structuredData: Record<string, unknown>
): string {
	try {
		const num = typeof value === 'string' ? BigInt(value) : BigInt(value)

		// Get token decimals
		let decimals = 18 // default
		let ticker = 'TOKEN'

		const tokenPath = params.tokenPath as string | undefined
		if (tokenPath) {
			const tokenAddr = resolvePath(descriptor, container, structuredData, tokenPath)
			// In real implementation, would fetch token metadata
			if (tokenAddr === params.nativeCurrencyAddress) {
				ticker = 'ETH'
				decimals = 18
			}
		}

		// Check threshold
		const threshold = params.threshold as string | undefined
		if (threshold && num >= BigInt(threshold)) {
			const message = (params.message as string) || 'Unlimited'
			return `${message} ${ticker}`
		}

		// Format with decimals
		const amount = Number(num) / Math.pow(10, decimals)
		return amount.toLocaleString('en-US', { maximumFractionDigits: decimals }) + ' ' + ticker
	} catch (error) {
		return String(value)
	}
}

function formatDate(value: string | number, params: Record<string, unknown>): string {
	try {
		let timestamp: number

		if (params.encoding === 'timestamp') {
			timestamp = typeof value === 'string' ? parseInt(value) : (value as number)
		} else if (params.encoding === 'blockheight') {
			// Approximate block height to timestamp (13s per block)
			const blockHeight = typeof value === 'string' ? parseInt(value) : (value as number)
			timestamp = Math.floor(blockHeight * 13)
		} else {
			return String(value)
		}

		const date = new Date(timestamp * 1000)
		return date.toISOString()
	} catch (error) {
		return String(value)
	}
}

function formatDuration(value: number): string {
	const hours = Math.floor(value / 3600)
	const minutes = Math.floor((value % 3600) / 60)
	const seconds = value % 60

	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatUnit(value: number, params: Record<string, unknown>): string {
	const base = (params.base as string) || ''
	const decimals = (params.decimals as number) || 0
	const prefix = (params.prefix as boolean) || false

	const amount = value / Math.pow(10, decimals)

	if (prefix) {
		const siPrefixes = ['', 'k', 'M', 'G', 'T', 'P']
		const exponent = Math.floor(Math.log10(amount) / 3)
		const mantissa = amount / Math.pow(10, exponent * 3)
		const prefixIndex = Math.max(0, Math.min(exponent + 1, siPrefixes.length - 1))
		return `${mantissa.toPrecision(3)}${siPrefixes[prefixIndex]}${base}`
	}

	return `${amount.toLocaleString('en-US', { maximumFractionDigits: decimals })}${base}`
}

function formatEnum(
	value: unknown,
	params: Record<string, unknown>,
	descriptor: ERC7730Descriptor
): string {
	const ref = params.$ref as string | undefined
	if (!ref) return String(value)

	// Navigate to enum definition
	const parts = ref.replace('$.metadata.enums.', '').split('.')
	let enumDef = descriptor.metadata?.enums?.[parts[0]]

	if (enumDef && enumDef[String(value)]) {
		return enumDef[String(value)]
	}

	return String(value)
}

function formatAddressName(value: string, params: Record<string, unknown>): string {
	// Check if matches sender
	const senderAddress = params.senderAddress as string[] | string | undefined
	if (senderAddress) {
		const senders = Array.isArray(senderAddress) ? senderAddress : [senderAddress]
		if (senders.includes(value.toLowerCase())) {
			return 'Sender'
		}
	}

	// In real implementation, would resolve ENS and other sources
	// For now, return shortened address
	return value.slice(0, 6) + '...' + value.slice(-4)
}

function formatTokenTicker(_value: string, _params: Record<string, unknown>, descriptor: ERC7730Descriptor): string {
	// In real implementation, would fetch token ticker from contract
	if (descriptor.metadata?.token?.ticker) {
		return descriptor.metadata.token.ticker
	}
	return 'TOKEN'
}

function formatNftName(value: string | number, _params: Record<string, unknown>): string {
	const tokenId = String(value)

	// In real implementation, would fetch NFT metadata
	return `NFT #${tokenId}`
}

function formatCalldata(value: string, params: Record<string, unknown>): string {
	// For calldata, display a hash or truncated version
	const callee = params.calleePath || params.callee
	return `Call to ${String(callee).slice(0, 10)}... (${value.length} bytes)`
}

/**
 * Process interpolated intent with value substitution
 */
export function processInterpolatedIntent(
	intent: string,
	descriptor: ERC7730Descriptor,
	container: ContainerValues,
	structuredData: Record<string, unknown>,
	fields: FieldFormat[]
): string {
	let result = intent

	// Find all interpolation expressions {path}
	const interpolationRegex = /\{([^}]+)\}/g
	let match

	while ((match = interpolationRegex.exec(intent)) !== null) {
		const pathStr = match[1]
		const value = resolvePath(descriptor, container, structuredData, pathStr)

		// Find the corresponding field format
		const field = fields.find((f) => f.path === pathStr)
		if (field) {
			const formatted = formatField(value, field, descriptor, container, structuredData)
			result = result.replace(`{${pathStr}}`, formatted)
		}
	}

	return result
}

/**
 * Format all fields from a specification
 */
export function formatAllFields(
	descriptor: ERC7730Descriptor,
	container: ContainerValues,
	structuredData: Record<string, unknown>,
	fields: FieldFormat[]
): FormattedField[] {
	const results: FormattedField[] = []

	for (const field of fields) {
		if (!field.path) continue

		const value = resolvePath(descriptor, container, structuredData, field.path)
		const formatted = formatField(value, field, descriptor, container, structuredData)

		// Determine visibility
		let visible: 'always' | 'optional' | 'never' = 'always'
		if (typeof field.visible === 'string') {
			visible = field.visible as 'always' | 'optional' | 'never'
		}

		results.push({
			path: field.path,
			label: field.label,
			value: formatted,
			format: (field.format as FormatType) || 'raw',
			visible
		})
	}

	return results
}
