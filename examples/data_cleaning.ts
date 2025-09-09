import { dataCleaningTool, batchClean } from "../src/tools/dataCleaningTool";

async function demonstrateDataCleaning() {
  console.log("=== Data Cleaning Tool Examples ===\n");
  
  console.log("1. Phone Number Normalization:");
  console.log("-".repeat(40));
  
  const phoneExamples = [
    " +91-98765 43210 ",
    "00919876543210",
    "098765 43210",
    "(555) 123-4567",
    "555.123.4567"
  ];
  
  for (const phone of phoneExamples) {
    const result = await dataCleaningTool.invoke({
      input: phone,
      type: "phone"
    });
    const parsed = JSON.parse(result);
    if (!parsed.error) {
      console.log(`  "${phone}" → "${parsed.cleaned}"`);
    } else {
      console.log(`  "${phone}" → Error: ${parsed.error}`);
    }
  }
  
  console.log("\n2. Email Canonicalization:");
  console.log("-".repeat(40));
  
  const emailExamples = [
    "  John.Doe+newsletter@GMAIL.com  ",
    "admin@googlemail.com",
    "USER@EXAMPLE.COM",
    "test.email+tag@gmail.com"
  ];
  
  for (const email of emailExamples) {
    const result = await dataCleaningTool.invoke({
      input: email,
      type: "email"
    });
    const parsed = JSON.parse(result);
    if (!parsed.error) {
      console.log(`  "${email}" → "${parsed.cleaned}"`);
    } else {
      console.log(`  "${email}" → Error: ${parsed.error}`);
    }
  }
  
  console.log("\n3. Text/Whitespace Cleaning:");
  console.log("-".repeat(40));
  
  const textExample = `  This   text    has
  
  irregular     spacing
  and	tabs	between	words.  `;
  
  const textResult = await dataCleaningTool.invoke({
    input: textExample,
    type: "text"
  });
  const textParsed = JSON.parse(textResult);
  console.log(`  Original (${textParsed.metadata.originalLength} chars):`);
  console.log(`  "${textExample}"`);
  console.log(`  Cleaned (${textParsed.metadata.cleanedLength} chars):`);
  console.log(`  "${textParsed.cleaned}"`);
  console.log(`  Characters removed: ${textParsed.metadata.charactersRemoved}`);
  
  console.log("\n4. CSV Data Deduplication:");
  console.log("-".repeat(40));
  
  const csvData = `name,email,phone,city
John Doe,john@example.com,555-1234,New York
Jane Smith, jane@example.com , 555-5678 , Los Angeles
John Doe,john@example.com,555-1234,New York
Bob Johnson,  bob@example.com,555-9012,Chicago
Jane Smith,jane2@example.com,555-5678,Los Angeles`;
  
  console.log("  Original CSV (with duplicates and extra spaces):");
  console.log("  " + csvData.split("\n").join("\n  "));
  
  const csvResult = await dataCleaningTool.invoke({
    input: csvData,
    type: "csv",
    csvOptions: {
      deduplicateBy: ["name", "email"],
      trimWhitespace: true,
      normalizeHeaders: true
    }
  });
  
  const csvParsed = JSON.parse(csvResult);
  console.log("\n  Cleaned CSV (deduplicated by name+email, normalized headers):");
  console.log("  " + csvParsed.cleaned.split("\n").join("\n  "));
  console.log(`\n  Rows removed: ${csvParsed.metadata.rowsRemoved}`);
  
  console.log("\n5. Batch Processing:");
  console.log("-".repeat(40));
  
  const batchItems = [
    { input: " customer@GMAIL.com ", type: "email" as const },
    { input: "+1-555-867-5309", type: "phone" as const },
    { input: "  Extra   spaces  ", type: "text" as const },
    { input: "invalid-email", type: "email" as const },
    { input: "12345", type: "phone" as const }
  ];
  
  const batchResults = batchClean(batchItems);
  
  console.log("  Successful cleanings:");
  for (const result of batchResults.results) {
    console.log(`    [${result.type}] "${result.original}" → "${result.cleaned}"`);
  }
  
  if (batchResults.errors.length > 0) {
    console.log("\n  Errors:");
    for (const error of batchResults.errors) {
      console.log(`    [${error.type}] "${error.input}" → ${error.error}`);
    }
  }
  
  console.log("\n6. Integration with LangChain Agent:");
  console.log("-".repeat(40));
  console.log("  The dataCleaningTool can be integrated into a LangChain agent:");
  console.log(`
  import { ChatOpenAI } from "@langchain/openai";
  import { createToolCallingAgent } from "langchain/agents";
  import { dataCleaningTool } from "./src/tools/dataCleaningTool";
  
  const model = new ChatOpenAI({ temperature: 0 });
  const tools = [dataCleaningTool];
  
  const agent = await createToolCallingAgent({
    llm: model,
    tools,
    prompt: // your prompt here
  });
  
  // Agent can now clean data as part of its workflow
  const result = await agent.invoke({
    input: "Clean this phone number: (555) 123-4567"
  });`);
}

demonstrateDataCleaning().catch(console.error);