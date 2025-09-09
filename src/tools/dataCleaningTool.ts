import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";

export interface CleaningResult {
  original: string;
  cleaned: string;
  type: "email" | "phone" | "text" | "csv";
  metadata?: Record<string, any>;
}

export interface CSVCleaningOptions {
  deduplicateBy?: string | string[];
  trimWhitespace?: boolean;
  normalizeHeaders?: boolean;
}

function canonicalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmed)) {
    throw new Error(`Invalid email format: ${email}`);
  }
  
  const [localPart, domain] = trimmed.split("@");
  
  let cleanedLocal = localPart;
  if (domain === "gmail.com" || domain === "googlemail.com") {
    cleanedLocal = localPart.replace(/\./g, "");
    
    const plusIndex = cleanedLocal.indexOf("+");
    if (plusIndex !== -1) {
      cleanedLocal = cleanedLocal.substring(0, plusIndex);
    }
  }
  
  const canonicalDomain = domain === "googlemail.com" ? "gmail.com" : domain;
  
  return `${cleanedLocal}@${canonicalDomain}`;
}

function normalizePhoneNumber(phone: string): string {
  let cleaned = phone.replace(/[\s\-\(\)\.]/g, "");
  
  cleaned = cleaned.replace(/^00/, "+");
  
  if (cleaned.match(/^91\d{10}$/)) {
    cleaned = "+" + cleaned;
  }
  
  if (cleaned.match(/^0\d{10}$/)) {
    cleaned = "+91" + cleaned.substring(1);
  }
  
  if (!cleaned.startsWith("+") && cleaned.match(/^\d{10}$/)) {
    cleaned = "+1" + cleaned;
  }
  
  const phoneRegex = /^\+\d{10,15}$/;
  if (!phoneRegex.test(cleaned)) {
    throw new Error(`Invalid phone number format: ${phone}`);
  }
  
  return cleaned;
}

function trimWhitespace(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\t+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .replace(/^\s+|\s+$/gm, "");
}

function cleanCSVData(csvContent: string, options: CSVCleaningOptions = {}): string {
  const lines = csvContent.split("\n").filter(line => line.trim());
  
  if (lines.length === 0) {
    return "";
  }
  
  let headers = lines[0].split(",").map(h => h.trim());
  const dataRows = lines.slice(1);
  
  if (options.normalizeHeaders) {
    headers = headers.map(h => 
      h.toLowerCase()
        .replace(/[^a-z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "")
    );
  }
  
  let cleanedRows = dataRows.map(row => {
    const cells = row.split(",").map(cell => {
      let cleaned = cell.trim();
      if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
        cleaned = cleaned.slice(1, -1);
      }
      if (options.trimWhitespace) {
        cleaned = trimWhitespace(cleaned);
      }
      return cleaned;
    });
    return cells;
  });
  
  if (options.deduplicateBy) {
    const dedupeKeys = Array.isArray(options.deduplicateBy) 
      ? options.deduplicateBy 
      : [options.deduplicateBy];
    
    const keyIndices = dedupeKeys.map(key => {
      const index = headers.findIndex(h => h === key || h === key.toLowerCase());
      if (index === -1) {
        throw new Error(`Deduplication key not found: ${key}`);
      }
      return index;
    });
    
    const seen = new Set<string>();
    cleanedRows = cleanedRows.filter(row => {
      const key = keyIndices.map(i => row[i] || "").join("|");
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  
  const result = [
    headers.join(","),
    ...cleanedRows.map(row => 
      row.map(cell => 
        cell.includes(",") || cell.includes('"') || cell.includes("\n")
          ? `"${cell.replace(/"/g, '""')}"` 
          : cell
      ).join(",")
    )
  ];
  
  return result.join("\n");
}

const dataCleaningSchema = z.object({
  input: z.string().describe("The data to clean (email, phone, text, or CSV content)"),
  type: z.enum(["email", "phone", "text", "csv"]).describe("Type of data to clean"),
  csvOptions: z.object({
    deduplicateBy: z.union([z.string(), z.array(z.string())]).optional()
      .describe("Column name(s) to use for deduplication"),
    trimWhitespace: z.boolean().optional().default(true)
      .describe("Whether to trim whitespace from CSV cells"),
    normalizeHeaders: z.boolean().optional().default(false)
      .describe("Whether to normalize CSV headers to snake_case")
  }).optional().describe("Options for CSV cleaning")
});

export const dataCleaningTool = new DynamicStructuredTool({
  name: "data_cleaning",
  description: "Clean and normalize various types of data including emails, phone numbers, text, and CSV data",
  schema: dataCleaningSchema,
  func: async ({ input, type, csvOptions }) => {
    try {
      let result: CleaningResult;
      
      switch (type) {
        case "email":
          const cleanedEmail = canonicalizeEmail(input);
          result = {
            original: input,
            cleaned: cleanedEmail,
            type: "email",
            metadata: {
              wasGmail: cleanedEmail.endsWith("@gmail.com"),
              hadPlusAddress: input.includes("+")
            }
          };
          break;
          
        case "phone":
          const cleanedPhone = normalizePhoneNumber(input);
          result = {
            original: input,
            cleaned: cleanedPhone,
            type: "phone",
            metadata: {
              countryCode: cleanedPhone.match(/^\+(\d{1,3})/)?.[1],
              isInternational: true
            }
          };
          break;
          
        case "text":
          const cleanedText = trimWhitespace(input);
          result = {
            original: input,
            cleaned: cleanedText,
            type: "text",
            metadata: {
              originalLength: input.length,
              cleanedLength: cleanedText.length,
              charactersRemoved: input.length - cleanedText.length
            }
          };
          break;
          
        case "csv":
          const cleanedCSV = cleanCSVData(input, csvOptions || {});
          const originalRows = input.split("\n").filter(l => l.trim()).length;
          const cleanedRows = cleanedCSV.split("\n").length;
          result = {
            original: input,
            cleaned: cleanedCSV,
            type: "csv",
            metadata: {
              originalRows,
              cleanedRows,
              rowsRemoved: originalRows - cleanedRows,
              options: csvOptions
            }
          };
          break;
          
        default:
          throw new Error(`Unsupported data type: ${type}`);
      }
      
      return JSON.stringify(result, null, 2);
    } catch (error) {
      return JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error occurred",
        input,
        type
      });
    }
  }
});

export function batchClean(items: Array<{ input: string; type: "email" | "phone" | "text" }>) {
  const results: CleaningResult[] = [];
  const errors: Array<{ input: string; type: string; error: string }> = [];
  
  for (const item of items) {
    try {
      let cleaned: string;
      
      switch (item.type) {
        case "email":
          cleaned = canonicalizeEmail(item.input);
          break;
        case "phone":
          cleaned = normalizePhoneNumber(item.input);
          break;
        case "text":
          cleaned = trimWhitespace(item.input);
          break;
        default:
          throw new Error(`Unsupported type: ${item.type}`);
      }
      
      results.push({
        original: item.input,
        cleaned,
        type: item.type
      });
    } catch (error) {
      errors.push({
        input: item.input,
        type: item.type,
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }
  
  return { results, errors };
}