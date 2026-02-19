/**
 * PII Masking Utilities
 * 
 * This module provides functionality to detect and mask Personally Identifiable Information (PII)
 * in text using regex patterns and validation algorithms.
 */

/**
 * Validates a card number using Luhn's Algorithm
 * Used to detect valid credit/debit card numbers
 */
function isValidCardNumber(cardNumber: string): boolean {
    const digits = cardNumber.replace(/\D/g, '');

    // Card numbers are typically 13-19 digits
    if (digits.length < 13 || digits.length > 19) {
        return false;
    }

    let sum = 0;
    let isEven = false;

    // Loop through values starting from the rightmost digit
    for (let i = digits.length - 1; i >= 0; i--) {
        let digit = parseInt(digits[i], 10);

        if (isEven) {
            digit *= 2;
            if (digit > 9) {
                digit -= 9;
            }
        }

        sum += digit;
        isEven = !isEven;
    }

    return sum % 10 === 0;
}

/**
 * Checks a single word/token against all PII patterns sequentially
 * Returns the masked placeholder if a match is found, otherwise returns the original word
 */
function checkWordForPII(word: string): string {
    // 1. Check for Credit/Debit Card (using Luhn's Algorithm)
    // Match sequences of 13-19 digits (with optional spaces/hyphens)
    const cardPattern = /^\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{3,4}$/;
    if (cardPattern.test(word) && isValidCardNumber(word)) {
        return '[MASKED_CARD_NUMBER]';
    }

    // 2. Check for SSN (Social Security Number) - Format: XXX-XX-XXXX
    const ssnPattern = /^\d{3}[-\s]?\d{2}[-\s]?\d{4}$/;
    if (ssnPattern.test(word)) {
        return '[MASKED_SSN]';
    }

    // 3. Check for Phone Numbers (Indian format)
    // Matches: +91-XXXXXXXXXX, 91-XXXXXXXXXX, or 10 digits
    const phonePattern = /^(?:\+91[\-\s]?|91[\-\s]?)?\d{10}$/;
    if (phonePattern.test(word)) {
        return '[MASKED_PHONE_NUMBER]';
    }

    // 4. Check for Email Addresses
    const emailPattern = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$/;
    if (emailPattern.test(word)) {
        return '[MASKED_EMAIL]';
    }

    // 5. Check for Passwords (strong format: min 8 chars, 1 number, 1 lowercase, 1 uppercase, 1 special char)
    const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (passwordPattern.test(word)) {
        return '[MASKED_PASSWORD]';
    }

    // 6. Check for PAN Card (Indian Permanent Account Number)
    // Format: ABCDE1234F (5 letters, 4 digits, 1 letter)
    const panPattern = /^[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]$/;
    if (panPattern.test(word)) {
        return '[MASKED_PAN_CARD]';
    }

    // 7. Check for Aadhar Card (Indian UID)
    // Format: XXXX-XXXX-XXXX or XXXXXXXXXXXX (12 digits)
    const aadharPattern = /^\d{4}[\s\-]?\d{4}[\s\-]?\d{4}$/;
    if (aadharPattern.test(word)) {
        return '[MASKED_AADHAR_CARD]';
    }

    // 8. Check for Voter ID (Indian)
    // Format: ABC1234567 (3 letters followed by 7 numbers)
    const voterIdPattern = /^[A-Z]{3}\d{7}$/;
    if (voterIdPattern.test(word)) {
        return '[MASKED_VOTER_ID]';
    }

    // 9. Check for Passport Number
    // Format: A1234567 (1 letter followed by 7 numbers)
    const passportPattern = /^[A-Z]\d{7}$/;
    if (passportPattern.test(word)) {
        return '[MASKED_PASSPORT]';
    }

    // 10. Check for UPI ID
    // Format: username@bankname
    const upiPattern = /^[A-Za-z0-9._-]+@[A-Za-z0-9]+$/;
    if (upiPattern.test(word)) {
        const upiHandles = ['paytm', 'phonepe', 'googlepay', 'gpay', 'upi', 'okaxis', 'oksbi', 'okhdfcbank', 'okicici', 'ybl'];
        const domain = word.split('@')[1]?.toLowerCase();
        if (domain && upiHandles.some(handle => domain.includes(handle))) {
            return '[MASKED_UPI_ID]';
        }
    }

    // 11. Check for IP Address (IPv4)
    // Format: XXX.XXX.XXX.XXX
    const ipPattern = /^(?:\d{1,3}\.){3}\d{1,3}$/;
    if (ipPattern.test(word)) {
        const octets = word.split('.');
        if (octets.every(octet => {
            const num = parseInt(octet, 10);
            return num >= 0 && num <= 255;
        })) {
            return '[MASKED_IP_ADDRESS]';
        }
    }

    // No PII detected, return original word
    return word;
}

/**
 * Masks PII (Personally Identifiable Information) in text
 * 
 * Processes the text word by word, checking each word sequentially against all PII patterns:
 * 1. Credit/Debit cards (using Luhn's Algorithm)
 * 2. SSN (Social Security Number)
 * 3. Phone numbers (Indian format)
 * 4. Email addresses
 * 5. Passwords (strong format)
 * 6. PAN card (Indian)
 * 7. Aadhar card (Indian)
 * 8. Voter ID (Indian)
 * 9. Passport numbers
 * 10. UPI IDs
 * 11. IP addresses
 * 
 * @param text - The input text containing potential PII
 * @returns The text with PII replaced by placeholders
 */
export function mask_PII(text: string): string {
    // Split text into words while preserving whitespace
    const words = text.split(/(\s+)/);

    // Process each word one by one
    const maskedWords = words.map(word => {
        // Preserve whitespace as-is
        if (/^\s+$/.test(word)) {
            return word;
        }

        // Check the word against all PII patterns sequentially
        return checkWordForPII(word);
    });

    // Reconstruct the text
    return maskedWords.join('');
}
