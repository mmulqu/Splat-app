/**
 * Quality preset configurations for Gaussian Splatting
 */

export interface QualityPreset {
    id: string;
    name: string;
    description: string;
    iterations: number;
    estimatedTime: number; // in seconds (base estimate for 20 photos)
    costMultiplier: number; // relative to preview
    icon: string;
    color: string;
}

export const QUALITY_PRESETS: Record<string, QualityPreset> = {
    preview: {
        id: 'preview',
        name: 'Preview',
        description: 'Fast preview for quick validation',
        iterations: 3000,
        estimatedTime: 300, // 5 minutes
        costMultiplier: 0.5,
        icon: '🟢',
        color: '#4ade80'
    },
    standard: {
        id: 'standard',
        name: 'Standard',
        description: 'Balanced quality for most use cases',
        iterations: 7000,
        estimatedTime: 900, // 15 minutes
        costMultiplier: 1.0,
        icon: '🟡',
        color: '#facc15'
    },
    high: {
        id: 'high',
        name: 'High',
        description: 'High quality for presentations',
        iterations: 15000,
        estimatedTime: 1800, // 30 minutes
        costMultiplier: 2.0,
        icon: '🟠',
        color: '#fb923c'
    },
    ultra: {
        id: 'ultra',
        name: 'Ultra',
        description: 'Maximum quality for professional use',
        iterations: 30000,
        estimatedTime: 3600, // 60 minutes
        costMultiplier: 4.0,
        icon: '🔴',
        color: '#f87171'
    }
};

/**
 * Get quality preset by ID
 */
export function getQualityPreset(id: string): QualityPreset {
    return QUALITY_PRESETS[id] || QUALITY_PRESETS.standard;
}

/**
 * Get all quality presets as array
 */
export function getAllQualityPresets(): QualityPreset[] {
    return Object.values(QUALITY_PRESETS);
}

/**
 * Calculate cost for a quality preset
 */
export function calculatePresetCost(
    presetId: string,
    photoCount: number,
    gpuType: string = 'RTX_4090'
): number {
    const preset = getQualityPreset(presetId);
    const gpuPrices: Record<string, number> = {
        'RTX_4090': 0.35,
        'RTX_3090': 0.20,
        'A100_80GB': 2.17,
        'A100_40GB': 1.89,
        'T4': 0.40,
    };

    const hourlyRate = gpuPrices[gpuType] || 0.35;
    const colmapTime = (photoCount / 10) * 90; // ~90 sec per 10 images
    const trainingTime = preset.iterations * 0.5; // ~0.5 sec per iteration
    const overhead = 60;

    const totalSeconds = colmapTime + trainingTime + overhead;
    const totalHours = totalSeconds / 3600;
    const cost = totalHours * hourlyRate;

    return parseFloat(cost.toFixed(3));
}

/**
 * Recommend quality preset based on use case
 */
export function recommendQualityPreset(
    photoCount: number,
    useCase?: 'validation' | 'general' | 'presentation' | 'professional'
): QualityPreset {
    if (useCase === 'validation') return QUALITY_PRESETS.preview;
    if (useCase === 'presentation') return QUALITY_PRESETS.high;
    if (useCase === 'professional') return QUALITY_PRESETS.ultra;

    // Auto-recommend based on photo count
    if (photoCount < 10) return QUALITY_PRESETS.preview;
    if (photoCount < 20) return QUALITY_PRESETS.standard;
    if (photoCount < 40) return QUALITY_PRESETS.high;
    return QUALITY_PRESETS.ultra;
}
