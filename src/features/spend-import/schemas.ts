import { z } from "zod";
import { CSV_DATE_FORMATS, CSV_DECIMAL_FORMATS } from "./parsing";

export const previewCsvImportSchema = z.object({
  file: z.instanceof(File).refine((file) => file.size > 0, "File is required"),
});

const csvMappingFieldsSchema = {
  hasHeader: z.boolean(),
  dateColumn: z.coerce.number().int().min(0),
  amountColumn: z.coerce.number().int().min(0),
  descriptionColumn: z.coerce.number().int().min(0),
  dateFormat: z.enum(CSV_DATE_FORMATS),
  decimalFormat: z.enum(CSV_DECIMAL_FORMATS),
};

export const commitCsvImportSchema = z.object({
  batchId: z.string().uuid(),
  ...csvMappingFieldsSchema,
});

export type PreviewCsvImportInput = z.infer<typeof previewCsvImportSchema>;
export type CommitCsvImportInput = z.infer<typeof commitCsvImportSchema>;
