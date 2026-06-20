import fs from "fs";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { askAi } from "../services/openRouter.service.js";
import User from "../models/user.model.js";
import Interview from "../models/interview.model.js";

export const analyzeResume = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "Resume required" });
    }
    const filepath = req.file.path;
    const filebuffer = await fs.promises.readFile(filepath);
    const uint8Array = new Uint8Array(filebuffer);

    const pdf = await pdfjsLib.getDocument({ data: uint8Array }).promise;
    let resumeText = "";
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();

      const pageText = content.items.map((item) => item.str).join(" ");
      resumeText += pageText + "\n";
    }

    resumeText = resumeText.replace(/\s+/g, " ").trim();

    const messages = [
      {
        role: "system",
        content: `
You are an ATS resume parser.

Analyze the resume and return ONLY a valid JSON object.
Do not include markdown, explanations, or any extra text.

Rules:

1. role
- Return the most appropriate interview role for the candidate.
- If the resume explicitly mentions a current or previous job title, use that.
- Otherwise infer the most suitable role based on the candidate's education, work experience, internships, projects, skills, certifications, and achievements.
- Prefer broader professional roles as possible for that candidate over narrow specializations unless the resume clearly targets a specific domain.
- Do not use educational qualifications, degrees, majors, coursework, or institution names as the role.
- If no suitable role can be inferred, return an empty string.

2. experience
- Return the candidate's total professional work experience.
- If only internships are present, return the total internship duration.
- If neither professional experience nor internships are mentioned, return "0".

3. projects
- Return an array of strings.
- Each string should contain:
  - the project name
  - followed by a short descriptive title (3-8 words) separated by " - ".
- Do not include implementation details, technologies, achievements, or long descriptions.
- If no projects are found, return an empty array.

4. skills
- Return an array of relevant professional skills.
- Include relevant courseworks
- Keep most asked skills in an interview in general for that role from candidate skills on top (for example DSA plays major role in SDE, ML plays major role in ML engineer, communication plays major role in HR or management so keep them on top)
- Remove duplicates.

Return exactly this JSON format:

{
  "role": "",
  "experience": "",
  "projects": [],
  "skills": []
}
`,
      },
      {
        role: "user",
        content: resumeText,
      },
    ];

    const aiResponse = await askAi(messages);
    const parsed = JSON.parse(aiResponse);

    fs.unlinkSync(filepath);

    res.json({
      role: parsed.role,
      experience: parsed.experience,
      projects: parsed.projects,
      skills: parsed.skills,
      resumeText,
    });
  } catch (error) {
    console.error(error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return res.status(500).json({ message: error.message });
  }
};

export const generateQuestion = async (req, res) => {
  try {
    let { role, experience, mode, resumeText, projects, skills } = req.body;
    role = role?.trim();
    experience = experience?.trim();
    mode = mode?.trim();
    if (!role || !experience || !mode) {
      return res
        .status(400)
        .json({ message: "Role, Experience and Mode are required." });
    }
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    if (user.credits < 50) {
      return res.status(400).json({
        message: "Not enough credits. Minimum 50 required.",
      });
    }

    const projectText =
      Array.isArray(projects) && projects.length ? projects.join(", ") : "None";

    const skillsText =
      Array.isArray(skills) && skills.length ? skills.join(", ") : "None";

    const safeResume = resumeText?.trim() || "None";

    const userPrompt = `
    Role:${role}
    Experience:${experience}
    InterviewMode:${mode}
    Projects:${projectText}
    Skills:${skillsText}
    Resume:${safeResume}
    `;
    if (!userPrompt.trim()) {
      return res.status(400).json({
        message: "Prompt content is empty.",
      });
    }

    const messages = [
      {
        role: "system",
        content: `
You are an experienced professional interviewer conducting a realistic mock interview.

Your goal is to ask questions exactly as a skilled human interviewer would during a real interview.

Generate exactly 5 interview questions.

Output Rules:
- Return only the questions.
- Do NOT add greetings, introductions, explanations, feedback, or closing remarks.
- Do NOT number the questions.
- Do NOT use bullet points.
- Output one question per line.
- Each question must be a single complete sentence.
- Each question must contain between 15 and 25 words.
- Use clear, simple, and natural conversational English.

Question Progression:
Question 1 → Easy
Question 2 → Easy
Question 3 → Medium
Question 4 → Medium
Question 5 → Hard

Question Guidelines:
- Personalize every question using the candidate's resume and provided information.
- Focus on the candidate's target role, experience, projects, achievements, education, certifications, skills, and responsibilities when relevant.
- Ask practical, role-specific questions that evaluate understanding, decision-making, communication, problem-solving, and real-world experience.
- Avoid generic or repetitive questions.
- Avoid asking multiple questions in a single sentence.
- If the candidate has little or no professional experience, base the questions on projects, coursework, internships, certifications, extracurricular activities, or transferable skills.
- Adapt the questions to the interview mode and difficulty level provided.
- Ask questions that naturally become more challenging as the interview progresses.
- Don't ask other mode questions in current interview mode like don't ask HR related questions in technical interview and tech related questions in HR interview.

Prefer questions that require the candidate to explain:
- Design decisions.
- Trade-offs.
- Debugging approach.
- Problem-solving process.
- Real implementation details.
- Challenges faced.
- Performance improvements.
- Scalability.
- Security considerations.
- Testing strategy.

Real Interview Quality:
- Use your knowledge and try to put every question from most asked questions for that specific job role in past by most of the companies.
- Every question should help determine whether the candidate can perform the target job.
- Ask questions that experienced interviewers commonly ask in actual interviews.
- Prefer scenario-based and experience-based questions over opinion-based questions.
- Avoid trivia, textbook definitions, resume verification, or conversational filler.
- If a resume item is mentioned, ask about the reasoning, implementation, challenges, or outcomes rather than simply asking what was used.

Question Selection Priority (highest to lowest):
1. Real project implementation and technical decisions.
2. Work experience or internships.
3. System design or architecture appropriate for the candidate's level.
4. Problem-solving using scenarios related to the target role.
5. Resume achievements only when they lead to meaningful follow-up discussion.

Do not ask questions whose primary purpose is merely verifying resume content.


Return only the five questions, with exactly one question on each line.
`,
      },
      {
        role: "user",
        content: userPrompt,
      },
    ];

    const aiResponse = await askAi(messages);
    if (!aiResponse || !aiResponse.trim()) {
      return res.status(500).json({
        message: "AI returned empty response.",
      });
    }

    const questionsArray = aiResponse
      .split("\n")
      .map((q) => q.trim())
      .filter((q) => q.length > 0)
      .slice(0, 5);

    if (questionsArray.length === 0) {
      return res.status(500).json({
        message: "AI failed to generate questions.",
      });
    }

    user.credits -= 50;
    await user.save();

    const interview = await Interview.create({
      userId: user._id,
      role,
      experience,
      mode,
      resumeText: safeResume,
      questions: questionsArray.map((q, index) => ({
        question: q,
        difficulty: ["easy", "easy", "medium", "medium", "hard"][index],
        timeLimit: [60, 60, 90, 90, 120][index],
      })),
    });

    res.json({
      interviewId: interview._id,
      creditsLeft: user.credits,
      userName: user.name,
      questions: interview.questions,
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `failed to create interview ${error}` });
  }
};

export const submitAnswer = async (req, res) => {
  try {
    let { interviewId, questionIndex, answer, timeTaken } = req.body;

    const interview = await Interview.findById(interviewId);
    const question = interview.questions[questionIndex];

    // If no answer
    if (!answer) {
      question.score = 0;
      question.feedback = "You did not submit an answer.";
      question.answer = "";

      await interview.save();

      return res.json({
        feedback: question.feedback,
      });
    }

    // If time exceeded
    if (timeTaken > question.timeLimit) {
      question.score = 0;
      question.feedback = "Time limit exceeded. Answer not evaluated.";
      question.answer = answer;

      await interview.save();

      return res.json({
        feedback: question.feedback,
      });
    }

    const messages = [
      {
        role: "system",
        content: `
You are an experienced professional interviewer evaluating a candidate's interview answer.

Evaluate the response fairly, consistently, and objectively, just like a real interviewer.

Score the answer from 0 to 10 in these categories:

1. Confidence
- Measures confidence, composure, and how convincing the answer sounds.
- Ignore minor grammar or pronunciation mistakes unless they reduce clarity.

2. Communication
- Measures clarity, organization, fluency, and ease of understanding.
- Well-structured and concise answers should score higher.

3. Correctness
- Measures factual accuracy, relevance, completeness, and whether the answer actually addresses the question.
- Give partial credit for partially correct answers.
- If the answer is off-topic or incorrect, score appropriately.

Scoring Guidelines:
- 0-2: Very poor
- 3-4: Weak
- 5-6: Average
- 7-8: Good
- 9-10: Excellent

Rules:
- Be fair and unbiased.
- Do not inflate scores.
- Strong answers should earn high scores.
- Weak or incomplete answers should receive lower scores.
- Evaluate the content, not writing style alone.
- Consider both quality and relevance.
- If the candidate provides unnecessary information but still answers correctly, do not heavily penalize it.

Calculate:
finalScore = average of Confidence, Communication, and Correctness, rounded to the nearest whole number.

Feedback Rules:
- Write one natural sentence.
- 10-15 words only.
- Professional, constructive, and honest.
- Mention one strength or one improvement.
- Do not mention scores.
- Do not repeat the question.

Return ONLY valid JSON.
Do not include markdown.
Do not include code fences.
Do not include explanations.

JSON format:

{
  "confidence": number,
  "communication": number,
  "correctness": number,
  "finalScore": number,
  "feedback": "short professional feedback"
}
`,
      },
      {
        role: "user",
        content: `
Question:
${question.question}

Candidate Answer:
${answer}
`,
      },
    ];

    const aiResponse = await askAi(messages);

    const parsed = JSON.parse(aiResponse);

    question.answer = answer;
    question.confidence = parsed.confidence;
    question.communication = parsed.communication;
    question.correctness = parsed.correctness;
    question.score = parsed.finalScore;
    question.feedback = parsed.feedback;
    await interview.save();

    return res.status(200).json({ feedback: parsed.feedback });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `failed to submit answer ${error}` });
  }
};

export const finishInterview = async (req, res) => {
  try {
    const { interviewId } = req.body;
    const interview = await Interview.findById(interviewId);
    if (!interview) {
      return res.status(400).json({ message: "failed to find Interview" });
    }

    const totalQuestions = interview.questions.length;

    let totalScore = 0;
    let totalConfidence = 0;
    let totalCommunication = 0;
    let totalCorrectness = 0;

    interview.questions.forEach((q) => {
      totalScore += q.score || 0;
      totalConfidence += q.confidence || 0;
      totalCommunication += q.communication || 0;
      totalCorrectness += q.correctness || 0;
    });

    const finalScore = totalQuestions ? totalScore / totalQuestions : 0;

    const avgConfidence = totalQuestions ? totalConfidence / totalQuestions : 0;

    const avgCommunication = totalQuestions
      ? totalCommunication / totalQuestions
      : 0;

    const avgCorrectness = totalQuestions
      ? totalCorrectness / totalQuestions
      : 0;

    interview.finalScore = finalScore;
    interview.status = "Completed";

    await interview.save();

    return res.status(200).json({
      finalScore: Number(finalScore.toFixed(1)),
      confidence: Number(avgConfidence.toFixed(1)),
      communication: Number(avgCommunication.toFixed(1)),
      correctness: Number(avgCorrectness.toFixed(1)),
      questionWiseScore: interview.questions.map((q) => ({
        question: q.question,
        score: q.score || 0,
        feedback: q.feedback || "",
        confidence: q.confidence || 0,
        communication: q.communication || 0,
        correctness: q.correctness || 0,
      })),
    });
  } catch (error) {
    return res
      .status(500)
      .json({ message: `failed to finish Interview ${error}` });
  }
};

export const getMyInterviews = async (req, res) => {
  try {
    const interviews = await Interview.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .select("role experience mode finalScore status createdAt");

    return res.status(200).json(interviews);
  } catch (error) {
    return res
      .status(500)
      .json({ message: "failed to find Current User Interviews ${error}" });
  }
};

export const getInterviewReport = async (req, res) => {
  try {
    const interview = await Interview.findById(req.params.id);
    if (!interview) {
      return res.status(404).json({ message: "Interview not found" });
    }

    const totalQuestions = interview.questions.length;

    let totalConfidence = 0;
    let totalCommunication = 0;
    let totalCorrectness = 0;

    interview.questions.forEach((q) => {
      totalConfidence += q.confidence || 0;
      totalCommunication += q.communication || 0;
      totalCorrectness += q.correctness || 0;
    });

    const avgConfidence = totalQuestions ? totalConfidence / totalQuestions : 0;

    const avgCommunication = totalQuestions
      ? totalCommunication / totalQuestions
      : 0;

    const avgCorrectness = totalQuestions
      ? totalCorrectness / totalQuestions
      : 0;

    return res.json({
      finalScore: interview.finalScore,
      confidence: Number(avgConfidence.toFixed(1)),
      communication: Number(avgCommunication.toFixed(1)),
      correctness: Number(avgCorrectness.toFixed(1)),
      questionWiseScore: interview.questions,
    });
  } catch (error) {
    return res.status(500).json({
      message: `failed to find current User interview report ${error}`,
    });
  }
};
