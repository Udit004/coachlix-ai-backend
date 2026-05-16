// Exercises service - handles exercise search, filtering, and AI-powered exercise info
import Exercise from "../../models/Exercise.js";
import { redis } from "../../shared/cache.js";

export const exercisesService = {
  /**
   * Search and filter exercises from database
   */
  async searchExercises(query = {}) {
    try {
      const {
        search,
        category,
        difficulty,
        equipment,
        muscleGroups,
        popular,
        limit = 50,
        page = 1,
      } = query;

      let mongoQuery = { isActive: true };
      let sort = { popularity: -1, averageRating: -1 };

      // Build query based on filters
      if (search) {
        mongoQuery.$or = [
          { name: { $regex: search, $options: "i" } },
          { category: { $regex: search, $options: "i" } },
          { primaryMuscleGroups: { $in: [new RegExp(search, "i")] } },
          { secondaryMuscleGroups: { $in: [new RegExp(search, "i")] } },
          { equipment: { $in: [new RegExp(search, "i")] } },
        ];
      }

      if (category) mongoQuery.category = category;
      if (difficulty) mongoQuery.difficulty = difficulty;

      if (equipment) {
        const eqList = equipment.split(",").filter(Boolean);
        if (eqList.length > 0) {
          mongoQuery.equipment = {
            $in: eqList.map((e) => new RegExp(`^${e}$`, "i")),
          };
        }
      }

      if (muscleGroups) {
        const groups = muscleGroups
          .split(",")
          .filter(Boolean)
          .map((g) => new RegExp(`^${g}$`, "i"));
        if (groups.length > 0) {
          const muscleClause = [
            { primaryMuscleGroups: { $in: groups } },
            { secondaryMuscleGroups: { $in: groups } },
          ];
          if (mongoQuery.$or) {
            mongoQuery.$or = [...mongoQuery.$or, ...muscleClause];
          } else {
            mongoQuery.$or = muscleClause;
          }
        }
      }

      if (popular === "true") {
        sort = { popularity: -1, averageRating: -1 };
      }

      // Execute query with pagination
      const skip = (page - 1) * limit;
      let exercises = await Exercise.find(mongoQuery)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean();

      // Fallback: if no results, loosen filters
      if (exercises.length === 0) {
        const fallbackQuery = { isActive: true };
        if (category) fallbackQuery.category = category;
        if (difficulty) fallbackQuery.difficulty = difficulty;
        exercises = await Exercise.find(fallbackQuery)
          .sort({ popularity: -1, averageRating: -1 })
          .limit(limit)
          .lean();
      }

      const total = await Exercise.countDocuments(mongoQuery);

      return {
        exercises,
        total,
        page,
        limit,
        pages: Math.ceil(total / limit),
      };
    } catch (error) {
      console.error("[Exercises Service] Error searching exercises:", error);
      throw error;
    }
  },

  /**
   * Generate exercise info using Gemini AI
   */
  async generateExerciseWithAI(exerciseName) {
    try {
      const geminiApiKey = process.env.GEMINI_API_KEY;
      if (!geminiApiKey) {
        throw new Error("Gemini API key not configured");
      }

      const systemPrompt = `You are a professional fitness expert and exercise database specialist. Your task is to provide comprehensive, accurate exercise information based on the exercise name provided.

For the given exercise name, provide a detailed JSON response with the following structure:
{
  "name": "Proper exercise name",
  "category": "Exercise category (Strength/Cardio/Flexibility/Sports)",
  "difficulty": "Beginner/Intermediate/Advanced",
  "primaryMuscleGroups": ["array of primary muscles worked"],
  "secondaryMuscleGroups": ["array of secondary muscles worked"],
  "equipment": ["required equipment or bodyweight"],
  "instructions": ["step 1", "step 2", "step 3", "etc."],
  "description": "Brief description of the exercise",
  "tips": ["important form tips", "safety considerations"],
  "variations": ["easier variations", "harder variations"],
  "targetReps": "Recommended repetitions or duration",
  "restTime": "Recommended rest time between sets",
  "calories": "Approximate calories burned per minute (if applicable)",
  "benefits": ["key benefits of this exercise"]
}

Guidelines:
- Provide accurate, safe exercise information only
- If the exercise name is unclear or potentially dangerous, suggest safer alternatives
- Use proper anatomical terms for muscle groups
- Include safety considerations in tips
- Be specific with instructions
- Only respond with valid JSON format
- If you don't recognize the exercise, provide a similar safe alternative

Exercise name to analyze: "${exerciseName.trim()}"`;

      const geminiPayload = {
        contents: [
          {
            role: "user",
            parts: [{ text: systemPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          topP: 0.8,
          topK: 40,
          maxOutputTokens: 2000,
          stopSequences: [],
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
          },
          {
            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
          },
          {
            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE",
          },
        ],
      };

      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${geminiApiKey}`;

      console.log("🤖 Generating exercise info with AI for:", exerciseName);

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(geminiPayload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error("Gemini API error response:", errorBody);

        if (response.status === 403) {
          throw new Error("API key is invalid or has insufficient permissions");
        } else if (response.status === 404) {
          throw new Error("Invalid API endpoint or model not found");
        } else if (response.status === 429) {
          throw new Error("Rate limit exceeded. Please try again later");
        } else {
          throw new Error(
            `Gemini API request failed: ${response.status} ${response.statusText}`
          );
        }
      }

      const data = await response.json();

      if (data.error) {
        console.error("Gemini API error:", data.error);
        throw new Error(data.error.message || "Unknown API error");
      }

      const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!aiResponse) {
        throw new Error("No response from Gemini API");
      }

      const exerciseInfo = JSON.parse(aiResponse);
      return exerciseInfo;
    } catch (error) {
      console.error(
        "[Exercises Service] Error generating exercise with AI:",
        error
      );
      throw error;
    }
  },

  /**
   * Suggest exercises using RapidAPI ExerciseDB
   */
  async suggestExercises(query) {
    try {
      if (!query || query.trim().length < 2) {
        return { success: true, exercises: [] };
      }

      const apiKey = process.env.RAPIDAPI_KEY;
      if (!apiKey) {
        throw new Error("RapidAPI key is not configured");
      }

      const host = "exercisedb.p.rapidapi.com";

      const fetchFromAPI = async (path) => {
        const response = await fetch(`https://${host}${path}`, {
          headers: {
            "X-RapidAPI-Key": apiKey,
            "X-RapidAPI-Host": host,
          },
          cache: "no-store",
        });

        if (!response.ok) {
          return [];
        }

        const data = await response.json();
        return Array.isArray(data) ? data : [];
      };

      // Try multiple strategies to find exercises
      let list = await fetchFromAPI(`/exercises/name/${encodeURIComponent(query)}`);

      const bodyPartMap = {
        chest: "chest",
        back: "back",
        shoulders: "shoulders",
        shoulder: "shoulders",
        legs: "upper legs",
        quads: "upper legs",
        hamstrings: "upper legs",
        arms: "upper arms",
        biceps: "upper arms",
        triceps: "upper arms",
        forearms: "lower arms",
        calves: "lower legs",
        abs: "waist",
        core: "waist",
      };

      const lower = query.toLowerCase();

      if (list.length === 0 && bodyPartMap[lower]) {
        list = await fetchFromAPI(
          `/exercises/bodyPart/${encodeURIComponent(bodyPartMap[lower])}`
        );
      }

      // Fallback to fuzzy matching if needed
      if (list.length === 0) {
        try {
          const [targets, bodyParts, equipmentList] = await Promise.all([
            fetchFromAPI(`/exercises/targetList`),
            fetchFromAPI(`/exercises/bodyPartList`),
            fetchFromAPI(`/exercises/equipmentList`),
          ]);

          const findMatch = (arr) =>
            (arr || []).find((v) => String(v).toLowerCase() === lower);

          const matchedTarget = findMatch(targets);
          if (matchedTarget) {
            list = await fetchFromAPI(
              `/exercises/target/${encodeURIComponent(matchedTarget)}`
            );
          }
        } catch (err) {
          console.warn("[Exercises Service] Fuzzy match failed:", err);
        }
      }

      // Transform and limit results
      const exercises = list.slice(0, 20).map((ex) => ({
        id: ex.id,
        name: ex.name,
        target: ex.target,
        equipment: ex.equipment,
        bodyPart: ex.bodyPart,
      }));

      return { success: true, exercises };
    } catch (error) {
      console.error("[Exercises Service] Error suggesting exercises:", error);
      throw error;
    }
  },

  /**
   * Get exercise details
   */
  async getExerciseDetails(exerciseId) {
    try {
      const cacheKey = `exercise:${exerciseId}`;
      const cached = await redis.get(cacheKey);

      if (cached) {
        return typeof cached === "string" ? JSON.parse(cached) : cached;
      }

      const exercise = await Exercise.findById(exerciseId).lean();

      if (exercise) {
        await redis.set(cacheKey, JSON.stringify(exercise), "EX", 3600);
      }

      return exercise;
    } catch (error) {
      console.error("[Exercises Service] Error getting exercise details:", error);
      throw error;
    }
  },
};
