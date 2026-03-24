import axios from "./axiosInstance";

const BASE_URL = "/admin";

// Get a specific doctor by ID
export const getDoctor = (doctorId) => {
  return axios.get(`${BASE_URL}/doctors/${doctorId}`);
};

