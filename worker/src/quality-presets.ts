/**
 * Quality preset configurations for Gaussian Splatting
 */

export interface GaussianSplattingParams {
    // Training parameters
    iterations: number;
    position_lr_init: number;
    position_lr_final: number;
    position_lr_delay_mult: number;
    position_lr_max_steps: number;
    feature_lr: number;
    opacity_lr: number;
    scaling_lr: number;
    rotation_lr: number;

    // Spherical Harmonics
    sh_degree: number;

    // Densification
    percent_dense: number;
    densification_interval: number;
    opacity_reset_interval: number;
    densify_from_iter: number;
    densify_until_iter: number;
    densify_grad_threshold: number;

    // Rendering
    white_background: boolean;
    resolution_scales: number[];

    // Optimization
    lambda_dssim: number;

    // Output
    save_iterations: number[];
    test_iterations: number[];
}

export interface QualityPreset {
    id: string;
    name: string;
    description: string;
    iterations: number;
    estimatedTime: number; // in seconds (base estimate for 20 photos)
    costMultiplier: number; // relative to preview
    icon: string;
    color: string;
    params: GaussianSplattingParams;
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
        color: '#4ade80',
        params: {
            iterations: 3000,
            position_lr_init: 0.00016,
            position_lr_final: 0.0000016,
            position_lr_delay_mult: 0.01,
            position_lr_max_steps: 3000,
            feature_lr: 0.0025,
            opacity_lr: 0.05,
            scaling_lr: 0.005,
            rotation_lr: 0.001,
            sh_degree: 3,
            percent_dense: 0.01,
            densification_interval: 100,
            opacity_reset_interval: 3000,
            densify_from_iter: 500,
            densify_until_iter: 2500,
            densify_grad_threshold: 0.0002,
            white_background: false,
            resolution_scales: [1],
            lambda_dssim: 0.2,
            save_iterations: [3000],
            test_iterations: [1000, 2000, 3000]
        }
    },
    standard: {
        id: 'standard',
        name: 'Standard',
        description: 'Balanced quality for most use cases',
        iterations: 7000,
        estimatedTime: 900, // 15 minutes
        costMultiplier: 1.0,
        icon: '🟡',
        color: '#facc15',
        params: {
            iterations: 7000,
            position_lr_init: 0.00016,
            position_lr_final: 0.0000016,
            position_lr_delay_mult: 0.01,
            position_lr_max_steps: 7000,
            feature_lr: 0.0025,
            opacity_lr: 0.05,
            scaling_lr: 0.005,
            rotation_lr: 0.001,
            sh_degree: 3,
            percent_dense: 0.01,
            densification_interval: 100,
            opacity_reset_interval: 3000,
            densify_from_iter: 500,
            densify_until_iter: 6000,
            densify_grad_threshold: 0.0002,
            white_background: false,
            resolution_scales: [1],
            lambda_dssim: 0.2,
            save_iterations: [7000],
            test_iterations: [2000, 4000, 7000]
        }
    },
    high: {
        id: 'high',
        name: 'High',
        description: 'High quality for presentations',
        iterations: 15000,
        estimatedTime: 1800, // 30 minutes
        costMultiplier: 2.0,
        icon: '🟠',
        color: '#fb923c',
        params: {
            iterations: 15000,
            position_lr_init: 0.00016,
            position_lr_final: 0.0000016,
            position_lr_delay_mult: 0.01,
            position_lr_max_steps: 15000,
            feature_lr: 0.0025,
            opacity_lr: 0.05,
            scaling_lr: 0.005,
            rotation_lr: 0.001,
            sh_degree: 3,
            percent_dense: 0.01,
            densification_interval: 100,
            opacity_reset_interval: 3000,
            densify_from_iter: 500,
            densify_until_iter: 12000,
            densify_grad_threshold: 0.0002,
            white_background: false,
            resolution_scales: [1],
            lambda_dssim: 0.2,
            save_iterations: [7000, 15000],
            test_iterations: [5000, 10000, 15000]
        }
    },
    ultra: {
        id: 'ultra',
        name: 'Ultra',
        description: 'Maximum quality for professional use',
        iterations: 30000,
        estimatedTime: 3600, // 60 minutes
        costMultiplier: 4.0,
        icon: '🔴',
        color: '#f87171',
        params: {
            iterations: 30000,
            position_lr_init: 0.00016,
            position_lr_final: 0.0000016,
            position_lr_delay_mult: 0.01,
            position_lr_max_steps: 30000,
            feature_lr: 0.0025,
            opacity_lr: 0.05,
            scaling_lr: 0.005,
            rotation_lr: 0.001,
            sh_degree: 3,
            percent_dense: 0.01,
            densification_interval: 100,
            opacity_reset_interval: 3000,
            densify_from_iter: 500,
            densify_until_iter: 25000,
            densify_grad_threshold: 0.0002,
            white_background: false,
            resolution_scales: [1],
            lambda_dssim: 0.2,
            save_iterations: [7000, 15000, 30000],
            test_iterations: [7000, 15000, 22000, 30000]
        }
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

/**
 * Get default Gaussian Splatting parameters
 */
export function getDefaultParams(): GaussianSplattingParams {
    return { ...QUALITY_PRESETS.standard.params };
}

/**
 * Merge custom parameters with preset parameters
 */
export function mergeParams(
    presetId: string,
    customParams: Partial<GaussianSplattingParams>
): GaussianSplattingParams {
    const preset = getQualityPreset(presetId);
    return {
        ...preset.params,
        ...customParams
    };
}

/**
 * Validate Gaussian Splatting parameters
 */
export function validateParams(params: Partial<GaussianSplattingParams>): string[] {
    const errors: string[] = [];

    if (params.iterations !== undefined && (params.iterations < 1000 || params.iterations > 100000)) {
        errors.push('Iterations must be between 1000 and 100000');
    }

    if (params.sh_degree !== undefined && (params.sh_degree < 0 || params.sh_degree > 4)) {
        errors.push('SH degree must be between 0 and 4');
    }

    if (params.densify_grad_threshold !== undefined && params.densify_grad_threshold <= 0) {
        errors.push('Densification gradient threshold must be positive');
    }

    if (params.position_lr_init !== undefined && params.position_lr_init <= 0) {
        errors.push('Position learning rate must be positive');
    }

    return errors;
}

/**
 * Get parameter description for UI
 */
export function getParamDescription(paramName: keyof GaussianSplattingParams): string {
    const descriptions: Record<keyof GaussianSplattingParams, string> = {
        iterations: 'Total number of training iterations',
        position_lr_init: 'Initial learning rate for Gaussian positions',
        position_lr_final: 'Final learning rate for Gaussian positions',
        position_lr_delay_mult: 'Delay multiplier for position learning rate decay',
        position_lr_max_steps: 'Maximum steps for position learning rate schedule',
        feature_lr: 'Learning rate for Gaussian features (colors)',
        opacity_lr: 'Learning rate for Gaussian opacity',
        scaling_lr: 'Learning rate for Gaussian scales',
        rotation_lr: 'Learning rate for Gaussian rotations',
        sh_degree: 'Spherical harmonics degree (0-4) - higher = better view-dependent effects',
        percent_dense: 'Percentage of scene extent to consider dense',
        densification_interval: 'Iterations between densification operations',
        opacity_reset_interval: 'Iterations between opacity resets',
        densify_from_iter: 'Iteration to start densification',
        densify_until_iter: 'Iteration to stop densification',
        densify_grad_threshold: 'Gradient threshold for densification',
        white_background: 'Use white background instead of black',
        resolution_scales: 'Render at multiple resolution scales (1 = full res)',
        lambda_dssim: 'Weight for DSSIM loss (0-1, higher = more structure preservation)',
        save_iterations: 'Iterations at which to save checkpoints',
        test_iterations: 'Iterations at which to run test/validation'
    };

    return descriptions[paramName] || '';
}
