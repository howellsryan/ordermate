using ordermateAPI.DAL.Models;

namespace ordermateAPI.DAL.Interfaces;

public interface ICategoryRepository
{
    Task<CategoryModel?> Get(int id);
    Task<IEnumerable<CategoryModel?>> Get();
}