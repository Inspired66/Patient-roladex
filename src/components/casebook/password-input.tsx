export const PASSWORD_INPUT_PROPS = {
  autoCapitalize: "off",
  autoCorrect: "off",
  spellCheck: false,
} as const;

export const PASSWORD_CASE_NOTE = "Passwords are case-sensitive. Check capital letters and spaces.";

export function PasswordNote() {
  return <p className="slip-who">{PASSWORD_CASE_NOTE}</p>;
}
