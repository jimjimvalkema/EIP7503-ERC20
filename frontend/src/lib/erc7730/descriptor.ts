/**
 * ERC-7730 Descriptor Service
 * Handles loading and parsing ERC-7730 descriptors
 */

import type { ERC7730Descriptor, ContainerValues, StructuredDataFormat } from './types'

/**
 * Load an ERC-7730 descriptor from a URL or object
 */
export async function loadDescriptor(
	source: string | ERC7730Descriptor
): Promise<ERC7730Descriptor | null> {
	try {
		if (typeof source === 'string') {
			const response = await fetch(source)
			if (!response.ok) return null
			return (await response.json()) as ERC7730Descriptor
		}
		return source
	} catch (error) {
		console.error('Failed to load ERC-7730 descriptor:', error)
		return null
	}
}

/**
 * Verify that descriptor context matches the container and structured data
 */
export function verifyContext(
	descriptor: ERC7730Descriptor,
	container: ContainerValues
): boolean {
	if (!descriptor.context) return true

	const context = descriptor.context

	// Check contract context
	if (context.contract) {
		if (!container.to) return false

		const deployment = context.contract.deployments?.find(
			(d) => d.chainId === container.chainId && d.address.toLowerCase() === container.to?.toLowerCase()
		)

		if (!deployment) return false
	}

	// Check EIP-712 context
	if (context.eip712) {
		if (!container.to || !container.chainId) return false

		const deployment = context.eip712.deployments?.find(
			(d) => d.chainId === container.chainId && d.address.toLowerCase() === container.to?.toLowerCase()
		)

		if (!deployment) return false
	}

	return true
}

/**
 * Get the format specification for a function selector or message type
 */
export function getFormatSpec(
	descriptor: ERC7730Descriptor,
	selector: string | string
): StructuredDataFormat | null {
	if (!descriptor.display?.formats) return null

	// For function selector, try to find matching format
	if (typeof selector === 'string' && selector.startsWith('0x') && selector.length === 10) {
		// Match selector against all format specs
		for (const [key, format] of Object.entries(descriptor.display.formats)) {
			if (computeSelector(key) === selector) {
				return format
			}
		}
	}

	// For message type or key name, direct lookup
	return descriptor.display.formats[selector] || null
}

/**
 * Compute function selector from function signature
 * e.g., "transfer(address to,uint256 value)" -> "0xa9059cbb"
 */
export function computeSelector(functionSignature: string): string {
	// Extract just the types, remove parameter names
	const typeOnly = functionSignature.replace(/\s+\w+([,)])/g, '$1').replace(/\s+/g, '')

	// Compute keccak256 hash
	const encoder = new TextEncoder()
	const data = encoder.encode(typeOnly)

	// Simple keccak256 simulation (in real implementation, use proper library)
	const hash = hashFunction(data)
	return '0x' + hash.substring(0, 8)
}

/**
 * Simple hash function (replace with proper keccak256 in production)
 */
function hashFunction(data: Uint8Array): string {
	let hash = 0
	for (let i = 0; i < data.length; i++) {
		const byte = data[i]
		hash = ((hash << 5) - hash) + byte
		hash = hash & hash // Convert to 32bit integer
	}
	return Math.abs(hash).toString(16).padStart(64, '0')
}

/**
 * Merge includes into the main descriptor
 */
export async function mergeIncludes(descriptor: ERC7730Descriptor): Promise<ERC7730Descriptor> {
	const result = { ...descriptor }

	if (!result.includes) return result

	const includes = Array.isArray(result.includes) ? result.includes : [result.includes]

	for (const includeUrl of includes) {
		const included = await loadDescriptor(includeUrl)
		if (!included) continue

		// Recursively merge included descriptors
		const merged = await mergeIncludes(included)

		// Merge context
		if (merged.context) {
			result.context = { ...result.context, ...merged.context }
		}

		// Merge metadata
		if (merged.metadata) {
			result.metadata = { ...result.metadata, ...merged.metadata }
		}

		// Merge display formats
		if (merged.display?.formats) {
			result.display = result.display || {}
			result.display.formats = { ...merged.display.formats, ...result.display.formats }
		}

		// Merge definitions
		if (merged.display?.definitions) {
			result.display = result.display || {}
			result.display.definitions = { ...merged.display.definitions, ...result.display.definitions }
		}
	}

	return result
}

/**
 * Resolve a path reference in the descriptor or data
 */
export function resolvePath(
	descriptor: ERC7730Descriptor,
	container: ContainerValues,
	structuredData: Record<string, unknown>,
	pathStr: string
): unknown {
	// Determine root
	let root: 'descriptor' | 'container' | 'data' = 'data'
	let path = pathStr

	if (pathStr.startsWith('$')) {
		root = 'descriptor'
		path = pathStr.substring(1)
	} else if (pathStr.startsWith('@')) {
		root = 'container'
		path = pathStr.substring(1)
	} else if (pathStr.startsWith('#')) {
		root = 'data'
		path = pathStr.substring(1)
	}

	// Get the target object
	let target: unknown
	switch (root) {
		case 'descriptor':
			target = descriptor
			break
		case 'container':
			target = container
			break
		case 'data':
			target = structuredData
			break
	}

	// Navigate the path
	return navigatePath(target, path)
}

/**
 * Navigate a path string to get a value from an object
 * Supports dot notation, array indexing, and slicing
 */
function navigatePath(target: unknown, pathStr: string): unknown {
	if (!pathStr) return target

	const parts = pathStr.split('.')
	let current = target

	for (const part of parts) {
		if (current === null || current === undefined) return undefined

		// Handle array access with slicing: [index], [start:end], etc
		const arrayMatch = part.match(/^\[(.+)\]$/)
		if (arrayMatch) {
			const arrayKey = arrayMatch[1]

			if (arrayKey === '') {
				// Empty brackets [] mean all elements
				current = current
			} else if (arrayKey.includes(':')) {
				// Slice notation
				const [start, end] = arrayKey.split(':').map((s) => (s ? parseInt(s) : undefined))
				if (Array.isArray(current)) {
					current = current.slice(start, end)
				}
			} else {
				// Index access
				const index = parseInt(arrayKey)
				if (Array.isArray(current)) {
					current = current[index < 0 ? current.length + index : index]
				}
			}
		} else if (typeof current === 'object' && current !== null) {
			current = (current as Record<string, unknown>)[part]
		} else {
			return undefined
		}
	}

	return current
}
