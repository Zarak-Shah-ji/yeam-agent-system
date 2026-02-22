import { GoogleGenerativeAI } from '@google/generative-ai'

export const GEMINI_AVAILABLE = !!process.env.GEMINI_API_KEY

let _genAI: GoogleGenerativeAI | null = null

function getGenAI(): GoogleGenerativeAI {
  if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!)
  return _genAI
}

// Legacy: used by individual agent classes
export function getModel(systemInstruction: string) {
  return getGenAI().getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction,
  })
}

// Fast intent classification (cheap + low latency)
export function getFlashModel() {
  return getGenAI().getGenerativeModel({ model: 'gemini-2.0-flash' })
}

// High-capability model for agent responses with function calling
export function getProModel(systemInstruction: string) {
  return getGenAI().getGenerativeModel({
    model: 'gemini-2.5-pro-preview-06-05',
    systemInstruction,
  })
}
