import { z } from 'zod';
import type { TPreset } from './schemas';
import {
  EModelEndpoint,
  tPresetSchema,
  eModelEndpointSchema,
  AuthType,
  authTypeSchema,
} from './schemas';

export type ModelCapabilityType = 'reasoning' | 'upload_image' | 'web_search' | 'experimental' | 'deep_research';

export type TModelSpec = {
  name: string;
  label: string;
  preset: TPreset;
  order?: number;
  default?: boolean;
  description?: string;
  showIconInMenu?: boolean;
  showIconInHeader?: boolean;
  iconURL?: string | EModelEndpoint; // Allow using project-included icons
  authType?: AuthType;
  iconCapabilities?: ModelCapabilityType[];
  pricing?: {
    inputPrice?: number;    // Input price per million tokens
    outputPrice?: number;   // Output price per million tokens
    showPricing?: boolean;  // Whether to show the pricing badges
  };
};

// Define pricing schema for validation
export const pricingSchema = z.object({
  inputPrice: z.number().optional(),
  outputPrice: z.number().optional(),
  showPricing: z.boolean().optional(),
});

export const tModelSpecSchema = z.object({
  name: z.string(),
  label: z.string(),
  preset: tPresetSchema,
  order: z.number().optional(),
  default: z.boolean().optional(),
  description: z.string().optional(),
  showIconInMenu: z.boolean().optional(),
  showIconInHeader: z.boolean().optional(),
  iconURL: z.union([z.string(), eModelEndpointSchema]).optional(),
  authType: authTypeSchema.optional(),
  iconCapabilities: z.array(z.enum(['reasoning', 'upload_image', 'web_search', 'experimental', 'deep_research'])).optional(),
  pricing: pricingSchema.optional(),
});

export const specsConfigSchema = z.object({
  enforce: z.boolean().default(false),
  prioritize: z.boolean().default(true),
  list: z.array(tModelSpecSchema).min(1),
});

export type TSpecsConfig = z.infer<typeof specsConfigSchema>;
