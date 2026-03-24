import axios from "./axiosInstance";

const BASE_URL = "/bookings/hospital";

export const getNavatarsByHospital = (hospitalId) => {
  return axios.get(`${BASE_URL}/${hospitalId}`);
};
