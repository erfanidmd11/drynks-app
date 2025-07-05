// utils/getZodiacSign.ts

export const getZodiacSign = (birthdate: Date): { sign: string; emoji: string; description: string } => {
  const day = birthdate.getDate();
  const month = birthdate.getMonth() + 1; // 0-indexed

  const zodiac = [
    { sign: "Capricorn", emoji: "♑", description: "Disciplined, grounded, and ambitious.", from: [12, 22], to: [1, 19] },
    { sign: "Aquarius", emoji: "♒", description: "Independent and full of surprises.", from: [1, 20], to: [2, 18] },
    { sign: "Pisces", emoji: "♓", description: "Dreamy, creative, and intuitive.", from: [2, 19], to: [3, 20] },
    { sign: "Aries", emoji: "♈", description: "Bold, fiery, and ready for adventure.", from: [3, 21], to: [4, 19] },
    { sign: "Taurus", emoji: "♉", description: "Sensual, reliable, and loves luxury.", from: [4, 20], to: [5, 20] },
    { sign: "Gemini", emoji: "♊", description: "Witty, curious, and great at conversation.", from: [5, 21], to: [6, 20] },
    { sign: "Cancer", emoji: "♋", description: "Emotional, nurturing, and intuitive.", from: [6, 21], to: [7, 22] },
    { sign: "Leo", emoji: "♌", description: "Confident, charismatic, and always shining.", from: [7, 23], to: [8, 22] },
    { sign: "Virgo", emoji: "♍", description: "Detail-oriented, smart, and grounded.", from: [8, 23], to: [9, 22] },
    { sign: "Libra", emoji: "♎", description: "Charming, stylish, and loves balance.", from: [9, 23], to: [10, 22] },
    { sign: "Scorpio", emoji: "♏", description: "Passionate, deep, and magnetic.", from: [10, 23], to: [11, 21] },
    { sign: "Sagittarius", emoji: "♐", description: "Adventurous, optimistic, and wild at heart.", from: [11, 22], to: [12, 21] },
  ];

  const match = zodiac.find(z => {
    const [fromMonth, fromDay] = z.from;
    const [toMonth, toDay] = z.to;

    if (fromMonth === 12 && month === 1) return day <= toDay;
    if (toMonth === 1 && month === 12) return day >= fromDay;

    return (
      (month === fromMonth && day >= fromDay) ||
      (month === toMonth && day <= toDay)
    );
  });

  return match || { sign: "Unknown", emoji: "❓", description: "Unknown sign" };
};
