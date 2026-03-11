import type { Equation } from "../../models";
import { delete as deleteRecord, getAll, getById, save, STORE_NAMES } from "../db";

export async function saveEquation(equation: Equation): Promise<string> {
  return save(STORE_NAMES.equations, equation);
}

export async function getEquationById(id: string): Promise<Equation | undefined> {
  return getById(STORE_NAMES.equations, id);
}

export async function listEquations(): Promise<Equation[]> {
  return getAll(STORE_NAMES.equations);
}

export async function listEquationsBySectionId(sectionId: string): Promise<Equation[]> {
  const equations = await listEquations();
  return equations.filter((equation) => equation.sectionId === sectionId);
}

export async function deleteEquation(id: string): Promise<void> {
  await deleteRecord(STORE_NAMES.equations, id);
}
