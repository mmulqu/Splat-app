/**
 * Image optimization utilities for Splat App
 * Handles resizing, compression, and EXIF extraction
 */

// Optimal resolution for Gaussian Splatting (balance between quality and processing time)
export const DEFAULT_MAX_WIDTH = 1920;
export const DEFAULT_MAX_HEIGHT = 1080;
export const DEFAULT_JPEG_QUALITY = 0.90;

/**
 * Optimize image by resizing and compressing
 * @param {File} file - Original image file
 * @param {Object} options - Optimization options
 * @returns {Promise<{file: File, metadata: Object}>}
 */
export async function optimizeImage(file, options = {}) {
    const {
        maxWidth = DEFAULT_MAX_WIDTH,
        maxHeight = DEFAULT_MAX_HEIGHT,
        quality = DEFAULT_JPEG_QUALITY,
        preserveExif = true
    } = options;

    try {
        // Extract EXIF data before processing
        const exifData = preserveExif ? await extractExifData(file) : null;

        // Load image
        const img = await loadImage(file);

        // Calculate new dimensions
        const dimensions = calculateDimensions(img.width, img.height, maxWidth, maxHeight);

        // Check if resize is needed
        const needsResize = dimensions.width !== img.width || dimensions.height !== img.height;

        // Create canvas for optimization
        const canvas = document.createElement('canvas');
        canvas.width = dimensions.width;
        canvas.height = dimensions.height;
        const ctx = canvas.getContext('2d');

        // Enable image smoothing for better quality
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Draw image
        ctx.drawImage(img, 0, 0, dimensions.width, dimensions.height);

        // Convert to blob with compression
        const blob = await new Promise(resolve => {
            canvas.toBlob(resolve, 'image/jpeg', quality);
        });

        // Create new file with original name
        const optimizedFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), {
            type: 'image/jpeg',
            lastModified: Date.now()
        });

        // Prepare metadata
        const metadata = {
            original: {
                width: img.width,
                height: img.height,
                size: file.size,
                type: file.type
            },
            optimized: {
                width: dimensions.width,
                height: dimensions.height,
                size: optimizedFile.size,
                type: optimizedFile.type
            },
            wasResized: needsResize,
            compressionRatio: (optimizedFile.size / file.size).toFixed(2),
            savingsBytes: file.size - optimizedFile.size,
            savingsPercent: Math.round((1 - optimizedFile.size / file.size) * 100),
            exif: exifData
        };

        return {
            file: optimizedFile,
            metadata
        };

    } catch (error) {
        console.error('Image optimization error:', error);
        // Return original file if optimization fails
        return {
            file,
            metadata: {
                error: error.message,
                original: {
                    width: 0,
                    height: 0,
                    size: file.size,
                    type: file.type
                }
            }
        };
    }
}

/**
 * Load image from file
 * @param {File} file - Image file
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
    });
}

/**
 * Calculate optimal dimensions while preserving aspect ratio
 * @param {number} width - Original width
 * @param {number} height - Original height
 * @param {number} maxWidth - Maximum width
 * @param {number} maxHeight - Maximum height
 * @returns {Object} New dimensions
 */
function calculateDimensions(width, height, maxWidth, maxHeight) {
    let newWidth = width;
    let newHeight = height;

    // Check if resize needed
    if (width > maxWidth || height > maxHeight) {
        const aspectRatio = width / height;

        if (width > height) {
            // Landscape
            newWidth = Math.min(width, maxWidth);
            newHeight = Math.round(newWidth / aspectRatio);

            if (newHeight > maxHeight) {
                newHeight = maxHeight;
                newWidth = Math.round(newHeight * aspectRatio);
            }
        } else {
            // Portrait
            newHeight = Math.min(height, maxHeight);
            newWidth = Math.round(newHeight * aspectRatio);

            if (newWidth > maxWidth) {
                newWidth = maxWidth;
                newHeight = Math.round(newWidth / aspectRatio);
            }
        }
    }

    return {
        width: Math.round(newWidth),
        height: Math.round(newHeight)
    };
}

/**
 * Extract EXIF metadata from image
 * @param {File} file - Image file
 * @returns {Promise<Object>} EXIF data
 */
export async function extractExifData(file) {
    try {
        // Basic EXIF extraction using DataView
        // For full EXIF support, consider using exif-js or piexifjs library
        const arrayBuffer = await file.arrayBuffer();
        const dataView = new DataView(arrayBuffer);

        // Check for JPEG SOI marker (0xFFD8)
        if (dataView.getUint16(0) !== 0xFFD8) {
            return null;
        }

        // Look for APP1 marker (0xFFE1) which contains EXIF
        let offset = 2;
        while (offset < dataView.byteLength) {
            const marker = dataView.getUint16(offset);

            if (marker === 0xFFE1) {
                // Found APP1 marker
                const segmentLength = dataView.getUint16(offset + 2);

                // Check for "Exif" identifier
                const exifString = String.fromCharCode(
                    dataView.getUint8(offset + 4),
                    dataView.getUint8(offset + 5),
                    dataView.getUint8(offset + 6),
                    dataView.getUint8(offset + 7)
                );

                if (exifString === 'Exif') {
                    // Basic EXIF data found
                    return {
                        found: true,
                        segment: 'APP1',
                        length: segmentLength,
                        // For full parsing, use exif-js library
                        note: 'Full EXIF parsing requires exif-js library'
                    };
                }
            }

            // Move to next marker
            const segmentLength = dataView.getUint16(offset + 2);
            offset += 2 + segmentLength;
        }

        return null;

    } catch (error) {
        console.error('EXIF extraction error:', error);
        return null;
    }
}

/**
 * Batch optimize multiple images
 * @param {File[]} files - Array of image files
 * @param {Function} progressCallback - Progress callback (current, total)
 * @returns {Promise<Array>} Optimized results
 */
export async function batchOptimizeImages(files, progressCallback) {
    const results = [];

    for (let i = 0; i < files.length; i++) {
        if (progressCallback) {
            progressCallback(i + 1, files.length);
        }

        const result = await optimizeImage(files[i]);
        results.push(result);
    }

    return results;
}

/**
 * Calculate total savings from optimization
 * @param {Array} results - Optimization results
 * @returns {Object} Savings summary
 */
export function calculateSavings(results) {
    const totalOriginal = results.reduce((sum, r) => sum + r.metadata.original.size, 0);
    const totalOptimized = results.reduce((sum, r) => sum + r.metadata.optimized.size, 0);
    const totalSavings = totalOriginal - totalOptimized;

    return {
        totalOriginal,
        totalOptimized,
        totalSavings,
        savingsPercent: Math.round((totalSavings / totalOriginal) * 100),
        count: results.length,
        averageSavingsPerImage: Math.round(totalSavings / results.length)
    };
}

/**
 * Format bytes to human readable string
 * @param {number} bytes - Bytes
 * @returns {string} Formatted string
 */
export function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Detect blur in image using Laplacian variance
 * Higher variance = sharper image, Lower variance = blurrier image
 * @param {File} file - Image file
 * @returns {Promise<Object>} Blur detection results
 */
export async function detectBlur(file) {
    try {
        const img = await loadImage(file);

        // Create canvas for analysis
        const canvas = document.createElement('canvas');

        // Use smaller canvas for faster processing
        const maxSize = 500;
        let width = img.width;
        let height = img.height;

        if (width > maxSize || height > maxSize) {
            const scale = Math.min(maxSize / width, maxSize / height);
            width = Math.floor(width * scale);
            height = Math.floor(height * scale);
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Get image data
        const imageData = ctx.getImageData(0, 0, width, height);
        const data = imageData.data;

        // Convert to grayscale
        const gray = new Float32Array(width * height);
        for (let i = 0; i < data.length; i += 4) {
            const idx = i / 4;
            gray[idx] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        }

        // Apply Laplacian operator
        const laplacian = new Float32Array(width * height);
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = y * width + x;

                // Laplacian kernel
                const value =
                    -gray[idx - width - 1] - gray[idx - width] - gray[idx - width + 1] +
                    -gray[idx - 1] + 8 * gray[idx] - gray[idx + 1] +
                    -gray[idx + width - 1] - gray[idx + width] - gray[idx + width + 1];

                laplacian[idx] = value;
            }
        }

        // Calculate variance of Laplacian
        let mean = 0;
        let count = 0;

        for (let i = 0; i < laplacian.length; i++) {
            mean += laplacian[i];
            count++;
        }
        mean /= count;

        let variance = 0;
        for (let i = 0; i < laplacian.length; i++) {
            const diff = laplacian[i] - mean;
            variance += diff * diff;
        }
        variance /= count;

        // Determine blur level
        // These thresholds can be adjusted based on testing
        const SHARP_THRESHOLD = 100;
        const ACCEPTABLE_THRESHOLD = 50;

        let quality, level, recommendation;

        if (variance > SHARP_THRESHOLD) {
            quality = 'sharp';
            level = 'excellent';
            recommendation = 'Perfect for 3D reconstruction';
        } else if (variance > ACCEPTABLE_THRESHOLD) {
            quality = 'acceptable';
            level = 'good';
            recommendation = 'Suitable for reconstruction';
        } else {
            quality = 'blurry';
            level = 'poor';
            recommendation = 'Retake this photo for better results';
        }

        return {
            variance: Math.round(variance * 100) / 100,
            quality,
            level,
            recommendation,
            isBlurry: quality === 'blurry',
            isAcceptable: quality !== 'blurry'
        };

    } catch (error) {
        console.error('Blur detection error:', error);
        return {
            variance: 0,
            quality: 'unknown',
            level: 'unknown',
            recommendation: 'Could not analyze image',
            isBlurry: false,
            isAcceptable: true,
            error: error.message
        };
    }
}

/**
 * Batch blur detection for multiple images
 * @param {File[]} files - Array of image files
 * @param {Function} progressCallback - Progress callback
 * @returns {Promise<Array>} Blur detection results
 */
export async function batchBlurDetection(files, progressCallback) {
    const results = [];

    for (let i = 0; i < files.length; i++) {
        if (progressCallback) {
            progressCallback(i + 1, files.length);
        }

        const result = await detectBlur(files[i]);
        results.push({
            file: files[i],
            blur: result
        });
    }

    return results;
}

/**
 * Get blur statistics for a batch of results
 * @param {Array} results - Blur detection results
 * @returns {Object} Statistics
 */
export function getBlurStatistics(results) {
    const sharp = results.filter(r => r.blur.quality === 'sharp').length;
    const acceptable = results.filter(r => r.blur.quality === 'acceptable').length;
    const blurry = results.filter(r => r.blur.quality === 'blurry').length;

    const averageVariance = results.reduce((sum, r) => sum + r.blur.variance, 0) / results.length;

    return {
        total: results.length,
        sharp,
        acceptable,
        blurry,
        blurryPercentage: Math.round((blurry / results.length) * 100),
        acceptablePercentage: Math.round(((sharp + acceptable) / results.length) * 100),
        averageVariance: Math.round(averageVariance * 100) / 100,
        recommendation: blurry > results.length / 2 ?
            'Most photos are blurry. Consider retaking with better focus.' :
            blurry > 0 ?
            `${blurry} photo(s) may be blurry. Review before processing.` :
            'All photos look sharp! Ready for processing.'
    };
}
