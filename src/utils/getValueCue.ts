// src/utils/getValueCue.ts
import { getZodiacSign } from './getZodiacSign';

interface CueOptions {
  first_name?: string;
  gender?: string;
  preferences?: string[]; // ["Male", "TS"]
  birthdate?: Date;
}

export const getValueCue = ({ first_name, gender, preferences, birthdate }: CueOptions): string => {
  const name = first_name ? capitalize(first_name) : 'There';
  const pronoun = gender?.toLowerCase() === 'female' ? 'queen' : 'king';
  const prefs = preferences?.join(', ');
  const zodiac = birthdate ? getZodiacSign(birthdate) : null;

  const cueVariants = [
    `${name}, your next unforgettable night out is a swipe away 🍸`,
    `${name}, the stars are aligning${zodiac ? ` for a ${zodiac.sign} ${zodiac.emoji}` : ''}...`,
    `Someone who loves ${prefs} is nearby, ${name} — don’t miss out 😘`,
    `${name}, are you ready to be the ${pronoun} of the yacht party? 🛥️`,
    `${name}, someone’s waiting to toast with you 🍾`,
  ];

  const seed = Math.floor(Math.random() * cueVariants.length);
  return cueVariants[seed];
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
