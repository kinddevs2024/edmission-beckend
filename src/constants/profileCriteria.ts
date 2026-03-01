/**
 * Predefined options for student profile. Students can only select from these.
 * Universities filter students by the same criteria.
 */

export const ALLOWED_SKILLS: readonly string[] = [
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'Ruby', 'Go', 'Rust', 'Swift',
  'HTML', 'CSS', 'React', 'Vue.js', 'Angular', 'Node.js', 'SQL', 'MongoDB', 'Git', 'Docker',
  'Machine Learning', 'Data Analysis', 'Statistics', 'R', 'MATLAB', 'Excel', 'Tableau', 'Power BI',
  'Public Speaking', 'Writing', 'Research', 'Critical Thinking', 'Problem Solving', 'Teamwork',
  'Leadership', 'Project Management', 'Agile', 'Scrum', 'Communication', 'Presentation',
  'Photoshop', 'Illustrator', 'Figma', 'UI/UX Design', 'Graphic Design', 'Video Editing',
  'Piano', 'Guitar', 'Violin', 'Singing', 'Music Production', 'Composition',
  'Creative Writing', 'Journalism', 'Copywriting', 'Translation', 'Proofreading',
  'Marketing', 'SEO', 'Social Media', 'Content Creation', 'Digital Marketing',
  'Accounting', 'Finance', 'Economics', 'Business Strategy', 'Entrepreneurship',
  'Biology', 'Chemistry', 'Physics', 'Environmental Science', 'Psychology', 'Sociology',
  'Law', 'Political Science', 'International Relations', 'History', 'Philosophy',
  'Teaching', 'Tutoring', 'Mentoring', 'Curriculum Design', 'Educational Technology',
  'Medicine', 'Nursing', 'Public Health', 'Pharmacy', 'Veterinary',
  'Engineering', 'Civil Engineering', 'Mechanical Engineering', 'Electrical Engineering',
  'Architecture', 'Urban Planning', 'Construction Management',
  'Photography', 'Cinematography', 'Animation', '3D Modeling', 'Game Design',
  'Cybersecurity', 'Cloud Computing', 'DevOps', 'API Development', 'Mobile Development',
  'Negotiation', 'Sales', 'Customer Service', 'Event Planning', 'Logistics',
  'Foreign Languages', 'Linguistics', 'Literacy', 'Numeracy', 'Data Entry',
] as const;

export const ALLOWED_INTERESTS: readonly string[] = [
  'IT & Technology', 'Programming', 'Artificial Intelligence', 'Robotics', 'Startups',
  'Books', 'Literature', 'Poetry', 'Fiction', 'Non-fiction', 'Science Fiction',
  'Travel', 'Adventure', 'Hiking', 'Backpacking', 'Culture', 'Languages',
  'Science', 'Space', 'Astronomy', 'Mathematics', 'Research', 'Experiments',
  'Music', 'Concerts', 'Instruments', 'Composing', 'Music Theory',
  'Art', 'Painting', 'Drawing', 'Sculpture', 'Museums', 'Galleries',
  'Sports', 'Football', 'Basketball', 'Tennis', 'Swimming', 'Running', 'Yoga',
  'Gaming', 'Video Games', 'Board Games', 'Esports', 'Strategy Games',
  'Film', 'Cinema', 'Documentaries', 'Animation', 'Film Making',
  'Photography', 'Nature', 'Wildlife', 'Environment', 'Sustainability',
  'Cooking', 'Baking', 'Food', 'Culinary Arts', 'Nutrition',
  'Fashion', 'Design', 'Style', 'Textiles',
  'Politics', 'Social Issues', 'Human Rights', 'Volunteering', 'Community',
  'Business', 'Finance', 'Investing', 'Economics', 'Entrepreneurship',
  'History', 'Archaeology', 'Anthropology', 'Geography',
  'Psychology', 'Philosophy', 'Sociology', 'Self-improvement',
  'Education', 'Teaching', 'Learning', 'Online Courses', 'MOOCs',
  'Medicine', 'Health', 'Fitness', 'Mental Health', 'Wellness',
  'Journalism', 'Media', 'Blogging', 'Podcasts', 'Social Media',
  'Architecture', 'Urban Design', 'Interior Design', 'Real Estate',
  'Agriculture', 'Farming', 'Gardening', 'Ecology',
  'Law', 'Humanities', 'Ethics', 'Debate', 'Public Speaking',
  'Crafts', 'DIY', 'Handmade', 'Woodworking', 'Pottery',
  'Dance', 'Theatre', 'Acting', 'Performance', 'Stand-up',
  'Cryptocurrency', 'Blockchain', 'Fintech', 'Innovation',
  'Aviation', 'Cars', 'Engineering', 'Mechanics', 'Electronics',
  'Pets', 'Animals', 'Veterinary', 'Conservation', 'Marine Biology',
] as const;

export const ALLOWED_HOBBIES: readonly string[] = [
  'Reading', 'Writing', 'Blogging', 'Journaling', 'Poetry',
  'Gaming', 'Video Games', 'Board Games', 'Card Games', 'Chess', 'Puzzle Solving',
  'Watching Movies', 'TV Series', 'Documentaries', 'Anime', 'Streaming',
  'Listening to Music', 'Playing Instruments', 'Singing', 'Concerts',
  'Drawing', 'Painting', 'Sketching', 'Digital Art', 'Calligraphy',
  'Photography', 'Photo Editing', 'Videography', 'Vlogging',
  'Cooking', 'Baking', 'Trying New Recipes', 'Food Blogging',
  'Traveling', 'Road Trips', 'Camping', 'Hiking', 'Trekking', 'Climbing',
  'Running', 'Jogging', 'Cycling', 'Swimming', 'Gym', 'Yoga', 'Meditation',
  'Football', 'Basketball', 'Volleyball', 'Tennis', 'Badminton', 'Golf',
  'Dancing', 'Ballet', 'Salsa', 'Hip-hop', 'Contemporary',
  'Gardening', 'Plant Care', 'Indoor Plants', 'Bonsai',
  'Crafts', 'Knitting', 'Crochet', 'Sewing', 'Embroidery',
  'DIY Projects', 'Woodworking', 'Home Improvement', 'Furniture Making',
  'Collecting', 'Stamps', 'Coins', 'Vinyl', 'Memorabilia',
  'Learning Languages', 'Duolingo', 'Language Exchange', 'Travel Planning',
  'Coding Side Projects', 'Open Source', 'Hackathons', 'Tech Tinkering',
  'Podcasts', 'Audiobooks', 'Ted Talks', 'Online Courses',
  'Socializing', 'Meetups', 'Networking', 'Community Events',
  'Volunteering', 'Charity', 'Mentoring', 'Tutoring',
  'Shopping', 'Fashion', 'Thrifting', 'Antiques',
  'Fishing', 'Hunting', 'Outdoor Activities', 'Nature Walks',
  'Motorcycles', 'Cars', 'Racing', 'Mechanics',
  'Magic', 'Card Tricks', 'Puzzles', 'Escape Rooms',
  'Stand-up Comedy', 'Improv', 'Theatre', 'Acting',
  'Astronomy', 'Stargazing', 'Telescope', 'Space Exploration',
  'Baking', 'Desserts', 'Chocolate Making', 'Wine Tasting',
  'Martial Arts', 'Boxing', 'MMA', 'Self-defense',
  'Board Game Design', 'Game Design', 'Storytelling', 'World Building',
  'Bird Watching', 'Wildlife', 'Safari', 'Eco-tourism',
  'Scuba Diving', 'Snorkeling', 'Surfing', 'Sailing', 'Kayaking',
  'Skateboarding', 'Rollerblading', 'Parkour', 'Extreme Sports',
  'Cosplay', 'Comic Cons', 'Fan Fiction', 'Fan Art',
  'Meditation', 'Mindfulness', 'Spirituality', 'Philosophy Reading',
  'Cooking Competitions', 'Food Tours', 'Restaurant Hopping',
  'Museum Hopping', 'Historical Sites', 'Cultural Events',
  'Karaoke', 'Open Mics', 'Live Music', 'Festivals',
  'Blogging', 'Content Creation', 'YouTube', 'TikTok', 'Instagram',
  'Trading', 'Investing', 'Stock Market', 'Crypto',
  'Reading Clubs', 'Book Clubs', 'Literary Events', 'Author Meetups',
] as const;

export type AllowedSkill = (typeof ALLOWED_SKILLS)[number];
export type AllowedInterest = (typeof ALLOWED_INTERESTS)[number];
export type AllowedHobby = (typeof ALLOWED_HOBBIES)[number];

const SKILL_SET = new Set(ALLOWED_SKILLS);
const INTEREST_SET = new Set(ALLOWED_INTERESTS);
const HOBBY_SET = new Set(ALLOWED_HOBBIES);

export function filterSkills(arr: string[]): string[] {
  return arr.filter((s) => SKILL_SET.has(s));
}

export function filterInterests(arr: string[]): string[] {
  return arr.filter((s) => INTEREST_SET.has(s));
}

export function filterHobbies(arr: string[]): string[] {
  return arr.filter((s) => HOBBY_SET.has(s));
}
