import User from '../../models/User.js';
import { getFirebaseAdmin } from '../../shared/firebaseAdmin.js';
import { getCloudinary } from '../../shared/cloudinary.js';

const PROFILE_CACHE_TTL = 900;

function buildProfilePayload(user) {
  if (!user) return null;

  return {
    id: user._id?.toString(),
    userId: user.firebaseUid,
    name: user.name,
    email: user.email,
    phone: user.phone,
    location: user.location,
    birthDate: user.birthDate,
    fitnessGoal: user.fitnessGoal,
    experience: user.experience,
    gender: user.gender,
    activityLevel: user.activityLevel,
    age: user.age,
    height: user.height,
    weight: user.weight,
    targetWeight: user.targetWeight,
    bio: user.bio,
    profileImage: user.profileImage,
    stats: user.stats,
    achievements: user.achievements,
    recentActivities: user.recentActivities,
    profileCompleted: user.profileCompleted !== false,
    needsOnboarding:
      user.profileCompleted === false ||
      (user.name === 'New User' && (!user.location || !user.location.trim()))
  };
}

async function getUserFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Authorization header missing');
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    throw new Error('Authorization header missing');
  }

  const admin = getFirebaseAdmin();
  const decodedToken = await admin.auth().verifyIdToken(token);
  return decodedToken;
}

async function getOrCreateProfile(decodedToken) {
  const firebaseUid = decodedToken.uid;
  const email = decodedToken.email?.toLowerCase() || null;

  let user = await User.findOne({ firebaseUid });

  if (!user && email) {
    user = await User.findOne({ email });
    if (user) {
      user.firebaseUid = firebaseUid;
      await user.save();
    }
  }

  if (!user) {
    user = new User({
      firebaseUid,
      name: 'New User',
      email,
      gender: 'other',
      fitnessGoal: 'Weight Loss',
      experience: 'Beginner',
      activityLevel: 'moderately active',
      stats: {
        workoutsCompleted: 0,
        daysStreak: 0,
        caloriesBurned: 0,
        totalHours: 0
      },
      achievements: [
        {
          title: 'Welcome!',
          description: 'Welcome to your fitness journey',
          icon: 'Star',
          earned: true,
          earnedDate: new Date()
        }
      ],
      recentActivities: [],
      profileCompleted: false
    });

    await user.save();
  }

  return user;
}

export async function getUserProfile(request, reply) {
  try {
    const decodedToken = await getUserFromToken(request.headers.authorization || request.headers.Authorization || '');
    const user = await getOrCreateProfile(decodedToken);
    const profileData = buildProfilePayload(user);

    reply.header('Cache-Control', 's-maxage=900, stale-while-revalidate');
    return reply.code(200).send({ success: true, data: profileData });
  } catch (error) {
    const statusCode = error.message === 'Authorization header missing' ? 401 : 500;
    return reply.code(statusCode).send({
      success: false,
      error: statusCode === 401 ? 'Unauthorized' : 'Internal server error',
      details: statusCode === 500 ? error.message : undefined
    });
  }
}

export async function updateUserProfile(request, reply) {
  try {
    const decodedToken = await getUserFromToken(request.headers.authorization || request.headers.Authorization || '');
    const firebaseUid = decodedToken.uid;
    const email = decodedToken.email?.toLowerCase() || null;
    const body = request.body || {};

    if (!body.name || !email) {
      return reply.code(400).send({ success: false, error: 'Name and email are required' });
    }

    const existingUser = await User.findOne({ email, firebaseUid: { $ne: firebaseUid } });
    if (existingUser) {
      return reply.code(400).send({ success: false, error: 'Email already exists' });
    }

    const updatedUser = await User.findOneAndUpdate(
      { firebaseUid },
      {
        $set: {
          firebaseUid,
          email,
          name: body.name,
          phone: body.phone,
          location: body.location,
          birthDate: body.birthDate,
          fitnessGoal: body.fitnessGoal,
          experience: body.experience,
          gender: body.gender,
          activityLevel: body.activityLevel,
          age: body.age,
          height: body.height,
          weight: body.weight,
          targetWeight: body.targetWeight,
          bio: body.bio,
          profileCompleted: true,
          updatedAt: new Date()
        }
      },
      { new: true, runValidators: true, upsert: true }
    );

    return reply.code(200).send({
      success: true,
      message: 'Profile updated successfully',
      data: buildProfilePayload(updatedUser)
    });
  } catch (error) {
    return reply.code(500).send({ success: false, error: 'Internal server error', details: error.message });
  }
}

export async function uploadProfileImage(request, reply) {
  try {
    const decodedToken = await getUserFromToken(request.headers.authorization || request.headers.Authorization || '');
    const firebaseUid = decodedToken.uid;
    const file = await request.file();

    if (!file) {
      return reply.code(400).send({ success: false, error: 'No file uploaded' });
    }

    const mimeType = file.mimetype || file.type || '';

    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(mimeType)) {
      return reply.code(400).send({ success: false, error: 'Invalid file type. Only JPEG, PNG, and WebP are allowed.' });
    }

    const maxSize = 5 * 1024 * 1024;
    const buffer = await file.toBuffer();
    if (buffer.length > maxSize) {
      return reply.code(400).send({ success: false, error: 'File too large. Maximum size is 5MB.' });
    }

    const cloudinary = getCloudinary();

    const uploadRes = await new Promise((resolve, reject) => {
      cloudinary.uploader.upload_stream(
        {
          folder: 'coachlix/profiles',
          public_id: `profile_${firebaseUid}`,
          overwrite: true,
          resource_type: 'image'
        },
        (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        }
      ).end(buffer);
    });

    const updatedUser = await User.findOneAndUpdate(
      { firebaseUid },
      { $set: { profileImage: uploadRes.secure_url, updatedAt: new Date() } },
      { new: true }
    );

    if (!updatedUser) {
      return reply.code(404).send({ success: false, error: 'User not found' });
    }

    return reply.code(200).send({
      success: true,
      message: 'Profile image uploaded successfully',
      imageUrl: uploadRes.secure_url
    });
  } catch (error) {
    return reply.code(500).send({ success: false, error: 'Internal server error', details: error.message });
  }
}

export async function deleteUserProfile(request, reply) {
  try {
    const decodedToken = await getUserFromToken(request.headers.authorization || request.headers.Authorization || '');
    const deletedUser = await User.findOneAndDelete({ firebaseUid: decodedToken.uid });

    if (!deletedUser) {
      return reply.code(404).send({ success: false, error: 'User not found' });
    }

    return reply.code(200).send({ success: true, message: 'Profile deleted successfully' });
  } catch (error) {
    const statusCode = error.message === 'Authorization header missing' ? 401 : 500;
    return reply.code(statusCode).send({
      success: false,
      error: statusCode === 401 ? 'Unauthorized' : 'Internal server error',
      details: statusCode === 500 ? error.message : undefined
    });
  }
}