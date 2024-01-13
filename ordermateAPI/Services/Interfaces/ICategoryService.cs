
using ordermateAPI.Models;

namespace ordermateAPI.Services.Interfaces;

public interface ICategoryService
{
    Task<CategoryModel> Get(int id);
    Task<List<CategoryModel>> Get();
}