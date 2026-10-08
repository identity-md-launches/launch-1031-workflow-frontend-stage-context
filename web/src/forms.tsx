import { useState } from "react";
import type { AbiFunction, AbiParameter } from "viem";
import type { Contract } from "./config";
import { parseInput } from "./logic";
import { Action, Field } from "./components";
export function ContractForm({
  contract,
  fn,
  label,
  description,
  defaults = {},
  disabled = false,
  reason,
}: {
  contract: Contract;
  fn: string;
  label: string;
  description: string;
  defaults?: Record<string, string>;
  disabled?: boolean;
  reason?: string;
}) {
  const abi = contract.abi.find(
    (x) => x.type === "function" && x.name === fn,
  ) as AbiFunction | undefined;
  const [values, setValues] = useState<Record<string, string>>(defaults);
  if (!abi) return <p role="alert">The pinned ABI does not expose {fn}.</p>;
  return (
    <details className="contract-form">
      <summary>{label}</summary>
      <p>{description}</p>
      {abi.inputs.map((p, i) => (
        <Field
          key={i}
          label={`${p.name || "Value"} (${p.type === "tuple" ? "JSON object" : p.type})`}
          value={values[p.name || String(i)] ?? ""}
          onChange={(v) => setValues({ ...values, [p.name || String(i)]: v })}
          multiline={p.type === "tuple" || p.type === "bytes"}
          options={
            p.type === "bool"
              ? [
                  { value: "", label: "Choose…" },
                  { value: "true", label: "True" },
                  { value: "false", label: "False" },
                ]
              : undefined
          }
          hint={
            p.type === "tuple"
              ? "Fields: " +
                ("components" in p
                  ? p.components.map((c) => `${c.name}: ${c.type}`).join(", ")
                  : "") +
                ". Quote large integers."
              : p.type.startsWith("uint")
                ? "Use a whole number in contract units. Timestamps and durations use seconds; percentages use basis points."
                : undefined
          }
        />
      ))}
      <Action
        key={JSON.stringify(values)}
        label={label}
        disabled={disabled}
        reason={reason}
        prepare={() => {
          const args = abi.inputs.map((p, i) => {
            let v: any = values[p.name || String(i)];
            if (p.name === "m" && p.type === "tuple") {
              v = JSON.parse(v);
              v = v.message ?? v;
            }
            return parseInput(p as AbiParameter, v);
          });
          return {
            contract,
            functionName: fn,
            args,
            summary: description + " Parameters: " + JSON.stringify(values),
          };
        }}
      />
    </details>
  );
}
